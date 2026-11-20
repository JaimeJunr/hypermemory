import type { ModelCompleteResult, On } from "claude-code";
import { expect, test } from "claude-code/testing";

const SESSION = "abcdef12-3456";
const DIR = "/home/u/.claude/hypermemory/sessoes/-repo";
const COMPOSE = { model: "m", promptModel: "m", surfaces: [], tools: [], outputStyle: null, traits: [] } as const;
const TURN = { answer: "ok", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" } as const;
const MESSAGES = [
  { role: "user" as const, text: "conserta o login", toolUses: [] },
  {
    role: "assistant" as const,
    text: "corrigi",
    toolUses: [{ tool_use_id: "u1", tool: "Edit", input: { file_path: "/repo/login.ts" } }],
  },
];
const OPEN = `---\nname: handoff-2026-11-19-11111111\ndescription: "d"\nmetadata:\n  type: project\n  kind: session\n  status: open\n  claimed_by:\n---\n\ncorpo por regra\n`;

interface World {
  readonly writes: Map<string, string>;
  readonly prompts: string[];
}

// Disco e modelo falsos: files é o que já existe na pasta pessoal; reply é o que o Haiku responde.
function world(on: On, files: Record<string, string>, reply: ModelCompleteResult, readFails: boolean = false): World {
  const writes = new Map<string, string>(Object.entries(files));
  const prompts: string[] = [];
  on("env.get", () => ({ value: "/home/u" }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("session.id", () => ({ value: SESSION }));
  on("session.messages", () => {
    if (readFails) throw new Error("boom");
    return { value: MESSAGES };
  });
  on("clock.now", () => ({ value: new Date(2026, 10, 20, 12).getTime() }));
  on("fs.list", (_, e) => ({
    value: [...writes.keys()]
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => ({ name: path.slice(e.path.length + 1), kind: "file", size: 0, mtimeMs: 0, isLink: false })),
  }));
  on("fs.read", (_, e) => {
    const value = writes.get(e.path);
    if (value === undefined) throw new Error(`ENOENT ${e.path}`);
    return { value };
  });
  on("fs.write", (_, e) => {
    writes.set(e.path, e.text);
    return { value: undefined };
  });
  on("model.complete", (_, e) => {
    prompts.push(e.prompt);
    return { value: reply };
  });
  return { writes, prompts };
}

const answered: ModelCompleteResult = {
  isAnswered: true,
  text: "resumo do Haiku",
  usage: { input_tokens: 10, output_tokens: 5 },
} as unknown as ModelCompleteResult;

test("o prompt do sistema ganha as regras e o resumo da sessão anterior, sem CLAUDE.md", async ($, on) => {
  const w = world(on, { [`${DIR}/handoff-2026-11-19-11111111.md`]: OPEN }, answered);
  on("prompt.compose", () => ({ sections: [] }));
  const { sections } = await $.prompt.compose(COMPOSE);
  expect(sections.map((s) => s.id)).toEqual(["hypermemory-escopo:rules", "hypermemory-escopo:previous-session"]);
  expect(sections.every((s) => s.scope === "session")).toBe(true);
  expect(sections[1]?.text).toContain("resumo do Haiku");
  expect(w.writes.get(`${DIR}/handoff-2026-11-19-11111111.md`)).toContain("status: claimed");
  expect(w.prompts).toHaveLength(1);
});

test("sem handoff aberto só as regras entram", async ($, on) => {
  world(on, {}, answered);
  on("prompt.compose", () => ({ sections: [] }));
  expect((await $.prompt.compose(COMPOSE)).sections.map((s) => s.id)).toEqual(["hypermemory-escopo:rules"]);
});

test("com o modelo fora do ar o texto por regra é injetado", async ($, on) => {
  world(on, { [`${DIR}/handoff-2026-11-19-11111111.md`]: OPEN }, {
    isAnswered: false,
    reason: "aborted",
  } as ModelCompleteResult);
  on("prompt.compose", () => ({ sections: [] }));
  const { sections } = await $.prompt.compose(COMPOSE);
  expect(sections[1]?.text).toContain("corpo por regra");
});

test("prompt bare não ganha seção nenhuma", async ($, on) => {
  world(on, {}, answered);
  on("prompt.compose", () => ({ sections: [] }));
  expect((await $.prompt.compose({ ...COMPOSE, traits: ["bare"] })).sections).toEqual([]);
});

test("o fim de cada turno do agente principal reescreve o handoff da sessão", async ($, on) => {
  const w = world(on, {}, answered);
  on("turn.complete", () => ({ text: "ok" }));
  await $.turn.complete(TURN);
  await $.turn.complete(TURN);
  expect([...w.writes.keys()]).toEqual([`${DIR}/handoff-2026-11-20-abcdef12.md`]);
  expect(w.writes.get(`${DIR}/handoff-2026-11-20-abcdef12.md`)).toContain("/repo/login.ts");
});

test("turno de subagente não grava handoff", async ($, on) => {
  const w = world(on, {}, answered);
  on("turn.complete", () => ({ text: "ok" }));
  await $.turn.complete({ ...TURN, agentId: "sub-1" });
  expect(w.writes.size).toBe(0);
});

const END = { reason: "other", sessionId: SESSION, resume: { id: SESSION } } as const;

test("session.end faz o último checkpoint", async ($, on) => {
  const w = world(on, {}, answered);
  on("session.end", () => ({ sessionId: SESSION }));
  await $.session.end(END);
  expect(w.writes.size).toBe(1);
});

test("session.end com falha na leitura do transcript não trava a saída nem grava", async ($, on) => {
  const w = world(on, {}, answered, true);
  on("session.end", () => ({ sessionId: SESSION }));
  expect((await $.session.end(END)).sessionId).toBe(SESSION);
  expect(w.writes.size).toBe(0);
});
