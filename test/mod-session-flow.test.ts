import { expect, test } from "bun:test";
import { CAPTURE_SYSTEM } from "../mod/hooks/capture-rules";
import { HAIKU_SUMMARY, parseHandoff, type TranscriptMessage } from "../mod/hooks/handoff-rules";
import { summaryPath } from "../mod/hooks/inject-context.mjs";
import { loadPrevious, prepareSummary, type SessionIo, writeCheckpoint } from "../mod/hooks/session-flow";

const DIR = "/home/u/.claude/hypermemory/sessoes/-repo";

class FakeSessionIo implements SessionIo {
  readonly files: Map<string, string>;
  readonly prompts: string[] = [];
  constructor(
    files: Record<string, string> = {},
    private readonly reply: string | null | Error = "resumo curto",
  ) {
    this.files = new Map(Object.entries(files));
  }
  home = async (): Promise<string> => "/home/u";
  cwd = async (): Promise<string> => "/repo";
  today = async (): Promise<string> => "2026-11-20";
  stamp = async (): Promise<string> => "2026-11-20-143000";
  readFile = async (path: string): Promise<string> => {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  };
  writeFile = async (path: string, text: string): Promise<void> => {
    this.files.set(path, text);
  };
  listFiles = async (dir: string): Promise<string[]> =>
    [...this.files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
  summarize = async (_system: string, prompt: string): Promise<string | undefined> => {
    this.prompts.push(prompt);
    if (this.reply instanceof Error) throw this.reply;
    return this.reply ?? undefined;
  };
}

const msgs: TranscriptMessage[] = [
  { role: "user", text: "conserta o login", toolUses: [] },
  { role: "assistant", text: "corrigi", toolUses: [{ tool: "Edit", input: { file_path: "/repo/login.ts" } }] },
];
const open = (id: string, body: string = "corpo"): string =>
  `---\nname: handoff-x-${id}\ndescription: "d"\nmetadata:\n  type: project\n  kind: session\n  status: open\n  claimed_by:\n---\n\n${body}\n`;

test("o checkpoint cria o handoff na pasta pessoal e reescreve no mesmo arquivo no turno seguinte", async () => {
  const io = new FakeSessionIo();
  await writeCheckpoint(io, "abcdef12-0000", msgs);
  expect([...io.files.keys()]).toEqual([`${DIR}/handoff-2026-11-20-143000-abcdef12.md`]);
  io.stamp = async () => "2026-11-21-090000";
  await writeCheckpoint(io, "abcdef12-0000", [...msgs, { role: "user", text: "e o logout", toolUses: [] }]);
  expect(io.files.size).toBe(1);
  expect(io.files.get(`${DIR}/handoff-2026-11-20-143000-abcdef12.md`)).toContain("e o logout");
});

test("o checkpoint não grava nada com transcript sem pedido do usuário", async () => {
  const io = new FakeSessionIo();
  await writeCheckpoint(io, "abcdef12-0000", []);
  expect(io.files.size).toBe(0);
});

test("a abertura reescreve com o modelo, injeta e passa o handoff para claimed", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-11111111.md`]: open("11111111", "corpo por regra") });
  const text = await loadPrevious(io, "sessao-nova-1");
  expect(text).toContain("## Resumo da sessão anterior neste projeto");
  expect(text).toContain("resumo curto");
  // Duas chamadas sobre o mesmo registro: o resumo e os candidatos a memória.
  expect(io.prompts).toEqual(["Registro da sessão:\n\ncorpo por regra", "Registro da sessão:\n\ncorpo por regra"]);
  const saved = parseHandoff(io.files.get(`${DIR}/handoff-2026-11-19-11111111.md`) ?? "");
  expect([saved.status, saved.claimedBy, saved.consolidated, saved.body]).toEqual([
    "claimed",
    "2026-11-20 sessao-nova-1",
    true,
    "resumo curto",
  ]);
});

test("sem handoff aberto não injeta nada nem chama o modelo; claimed por outra sessão não volta", async () => {
  const io = new FakeSessionIo({
    [`${DIR}/handoff-2026-11-19-11111111.md`]: open("11111111").replace("status: open", "status: claimed"),
  });
  expect(await loadPrevious(io, "sessao-nova-1")).toBeUndefined();
  expect(await loadPrevious(new FakeSessionIo(), "sessao-nova-1")).toBeUndefined();
  expect(io.prompts).toEqual([]);
});

test("se o modelo falha ou responde vazio, o texto por regra é injetado e claimed, sem consolidated", async () => {
  for (const reply of [new Error("boom"), null, "  "]) {
    const io = new FakeSessionIo(
      { [`${DIR}/handoff-2026-11-19-11111111.md`]: open("11111111", "texto por regra") },
      reply,
    );
    expect(await loadPrevious(io, "s2")).toContain("texto por regra");
    const saved = parseHandoff(io.files.get(`${DIR}/handoff-2026-11-19-11111111.md`) ?? "");
    expect([saved.status, saved.consolidated]).toEqual(["claimed", false]);
  }
});

test("handoff já consolidated não chama o modelo, e o que a sessão já pegou volta igual", async () => {
  const consolidated = open("11111111", "já reescrito").replace(
    "  claimed_by:\n",
    "  claimed_by:\n  consolidated: true\n",
  );
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-11111111.md`]: consolidated });
  const first = await loadPrevious(io, "s3");
  expect(first).toContain("já reescrito");
  expect(await loadPrevious(io, "s3")).toBe(first);
  expect(io.prompts).toEqual([]);
});

test("o handoff da própria sessão nunca é injetado nela", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-20-selfself.md`]: open("selfself") });
  expect(await loadPrevious(io, "selfself-9")).toBeUndefined();
});

test("a chamada ao modelo usa a constante única, com esforço baixo e teto de tokens", () => {
  expect(HAIKU_SUMMARY).toMatchObject({ model: "claude-haiku-5-5", effort: "low", maxTokens: 600, timeoutMs: 8000 });
});

// Várias sessões no mesmo dia: o id é aleatório, então só a hora no nome garante que a mais nova seja escolhida.
test("a abertura escolhe as sessões mais novas do dia pela hora, não pelo id", async () => {
  const io = new FakeSessionIo({}, null);
  const sessions: [string, string][] = [
    ["dddddddd-0000", "2026-11-20-090000"],
    ["cccccccc-0000", "2026-11-20-100000"],
    ["bbbbbbbb-0000", "2026-11-20-110000"],
    ["aaaaaaaa-0000", "2026-11-20-120000"],
  ];
  for (const [id, stamp] of sessions) {
    io.stamp = async () => stamp;
    await writeCheckpoint(io, id, [{ role: "user", text: `pedido da ${id.slice(0, 8)}`, toolUses: [] }]);
  }
  const injected: string = (await loadPrevious(io, "eeeeeeee-0000")) ?? "";
  expect(injected).toContain("pedido da aaaaaaaa");
  expect(injected).not.toContain("pedido da dddddddd");
});

test("o nome do handoff leva data e hora do primeiro turno", async () => {
  const io = new FakeSessionIo();
  await writeCheckpoint(io, "abcdef12-0000", msgs);
  expect([...io.files.keys()]).toEqual([`${DIR}/handoff-2026-11-20-143000-abcdef12.md`]);
});

test("prepareSummary grava o resumo onde o hook de comando lê, e nada sem sessão anterior", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-090000-11111111.md`]: open("11111111") });
  await prepareSummary(io, "abcdef12-0000");
  const path: string = summaryPath("/home/u", "/repo", "abcdef12-0000");
  expect(io.files.get(path)).toContain("resumo curto");
  const empty = new FakeSessionIo();
  await prepareSummary(empty, "abcdef12-0000");
  expect(empty.files.size).toBe(0);
});

test("o arquivo de resumo não é lido como handoff por outra sessão", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-090000-11111111.md`]: open("11111111") });
  await prepareSummary(io, "abcdef12-0000");
  const path: string = summaryPath("/home/u", "/repo", "abcdef12-0000");
  io.files.set(path, `<!-- hypermemory: entregue -->\n${io.files.get(path)}`);
  expect(await loadPrevious(io, "99999999-0000")).toBeUndefined();
});

// Achados do Codex no PR 5 (2026-11-20).
const DELIVERED_MARK = "<!-- hypermemory: entregue -->";

test("handoff pego por sessão que fechou antes do primeiro prompt volta para a sessão seguinte", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-090000-11111111.md`]: open("11111111", "notas.txt") });
  await prepareSummary(io, "abandona-0000");
  await prepareSummary(io, "seguinte-0000");
  expect(io.files.get(summaryPath("/home/u", "/repo", "seguinte-0000"))).toBeDefined();
});

test("depois de entregue, o handoff pego não volta para outra sessão", async () => {
  const io = new FakeSessionIo({ [`${DIR}/handoff-2026-11-19-090000-11111111.md`]: open("11111111", "notas.txt") });
  await prepareSummary(io, "entregue-0000");
  const path: string = summaryPath("/home/u", "/repo", "entregue-0000");
  io.files.set(path, `${DELIVERED_MARK}\n${io.files.get(path)}`);
  await prepareSummary(io, "seguinte-0000");
  expect(io.files.get(summaryPath("/home/u", "/repo", "seguinte-0000"))).toBeUndefined();
});

test("checkpoint gravado enquanto o modelo resume não é sobrescrito pelo resumo velho", async () => {
  const file: string = `${DIR}/handoff-2026-11-19-090000-11111111.md`;
  const newer: string = open("11111111", "trabalho mais novo");
  const io = new FakeSessionIo({ [file]: open("11111111", "trabalho velho") });
  io.summarize = async (): Promise<string> => {
    io.files.set(file, newer);
    return "resumo do velho";
  };
  await prepareSummary(io, "outra-0000");
  expect(io.files.get(file)).toBe(newer);
});

test("candidatos sugeridos pelo modelo entram no resumo injetado e no handoff gravado", async () => {
  const io = new FakeSessionIo(
    { [`${DIR}/handoff-2026-11-19-11111111.md`]: open("11111111", "corpo por regra") },
    "decision | Usar SQLite no cache",
  );
  const text = await loadPrevious(io, "sessao-nova-1");
  expect(text).toContain(
    "**Candidatos a memória (revise; grave só os que valem):**\n- decision | Usar SQLite no cache",
  );
  expect(io.files.get(`${DIR}/handoff-2026-11-19-11111111.md`)).toContain("- decision | Usar SQLite no cache");
});

test("falha só na reescrita não descarta os candidatos: entram no corpo por regra e no handoff gravado", async () => {
  const file: string = `${DIR}/handoff-2026-11-19-11111111.md`;
  const io = new FakeSessionIo({ [file]: open("11111111", "corpo por regra") });
  io.summarize = async (system: string): Promise<string | undefined> => {
    if (system === CAPTURE_SYSTEM) return "gotcha | Hook não roda no /clear";
    throw new Error("timeout");
  };
  const text = await loadPrevious(io, "sessao-nova-1");
  expect(text).toContain("corpo por regra");
  expect(text).toContain("- gotcha | Hook não roda no /clear");
  expect(io.files.get(file)).toContain("- gotcha | Hook não roda no /clear");
});
