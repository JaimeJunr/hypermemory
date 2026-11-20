import { expect, test } from "bun:test";
import { AGENT_RULES_TEXT } from "../mod/hooks/agent-rules";
import {
  BODY_LIMIT,
  buildBody,
  claimedContent,
  editedFiles,
  formatInjection,
  type HandoffFile,
  parseHandoff,
  projectSlug,
  renderHandoff,
  replaceBody,
  selectHandoffs,
  setField,
  type TranscriptMessage,
  userRequests,
} from "../mod/hooks/handoff-rules";

const user = (text: string): TranscriptMessage => ({ role: "user", text, toolUses: [] });
const assistant = (text: string, files: string[] = []): TranscriptMessage => ({
  role: "assistant",
  text,
  toolUses: files.map((file_path: string) => ({ tool: "Edit", input: { file_path } })),
});
const handoff = (status: string, claimedBy: string = "", consolidated: boolean = false): string =>
  renderHandoff({ name: "n", description: "d", body: "corpo" })
    .replace("status: open", `status: ${status}`)
    .replace("  claimed_by:\n", `  claimed_by: ${claimedBy}\n${consolidated ? "  consolidated: true\n" : ""}`);

test("projectSlug troca tudo que não é letra ou dígito por hífen, como a pasta de projetos do Claude Code", () => {
  expect(projectSlug("/mnt/xs1000/me/my.repo")).toBe("-mnt-xs1000-me-my-repo");
});

test("buildBody junta último texto, pedidos e arquivos editados, e corta no teto", () => {
  const body = buildBody([user("faz X"), assistant("feito", ["/a.ts", "/a.ts", "/b.ts"]), user("agora Y")]);
  expect(body).toContain("**Onde parou:** feito");
  expect(body).toContain("- faz X\n- agora Y");
  expect(body).toContain("- /a.ts\n- /b.ts");
  expect(buildBody([user("x".repeat(100)), assistant("y ".repeat(10_000))])?.length).toBeLessThanOrEqual(BODY_LIMIT);
});

test("buildBody devolve undefined sem pedido do usuário (transcript vazio ou só lembretes)", () => {
  expect(buildBody([])).toBeUndefined();
  expect(buildBody([user("<system-reminder>ruído</system-reminder>"), assistant("oi")])).toBeUndefined();
});

test("userRequests guarda só os 10 últimos, cada um cortado em 300 caracteres", () => {
  const requests = userRequests(Array.from({ length: 12 }, (_, i) => user(`pedido ${i} ${"z".repeat(400)}`)));
  expect(requests).toHaveLength(10);
  expect(requests[0]).toStartWith("pedido 2");
  expect(requests[0]?.length).toBe(300);
});

test("editedFiles ignora ferramentas que não editam e entradas sem caminho", () => {
  const read: TranscriptMessage = {
    role: "assistant",
    text: "",
    toolUses: [{ tool: "Read", input: { file_path: "/r" } }],
  };
  const odd: TranscriptMessage = { role: "assistant", text: "", toolUses: [{ tool: "Write", input: {} }] };
  expect(editedFiles([read, odd, assistant("", ["/w"])])).toEqual(["/w"]);
});

test("parseHandoff lê status, claimed_by, consolidated e corpo", () => {
  expect(parseHandoff(handoff("claimed", "2026-11-20 abc", true))).toEqual({
    status: "claimed",
    claimedBy: "2026-11-20 abc",
    consolidated: true,
    body: "corpo",
  });
  expect(parseHandoff("sem frontmatter").status).toBe("");
});

test("setField troca o campo existente, acrescenta o que falta e preserva campos escritos à mão", () => {
  const content = renderHandoff({ name: "n", description: "d", body: "b" }).replace(
    "kind: session",
    "kind: session\n  extra: 1",
  );
  const changed = setField(setField(content, "status", "claimed"), "consolidated", "true");
  expect(changed).toContain("  status: claimed\n");
  expect(changed).toContain("  extra: 1\n");
  expect(changed).toContain("  consolidated: true\n---");
  expect(setField("sem frontmatter", "status", "x")).toBe("sem frontmatter");
  expect(replaceBody(content, "novo")).toEndWith("---\n\nnovo\n");
});

test("claimedContent marca status claimed e quem pegou", () => {
  const parsed = parseHandoff(claimedContent(handoff("open"), "2026-11-20 sessao"));
  expect([parsed.status, parsed.claimedBy]).toEqual(["claimed", "2026-11-20 sessao"]);
});

test("selectHandoffs pega até 3 abertos mais recentes, sem o da própria sessão nem os já pegos por outra", () => {
  const file = (name: string, content: string): HandoffFile => ({ file: name, content });
  const files = [
    file("handoff-2026-11-01-aaaaaaaa.md", handoff("open")),
    file("handoff-2026-11-02-bbbbbbbb.md", handoff("open")),
    file("handoff-2026-11-03-cccccccc.md", handoff("open")),
    file("handoff-2026-11-04-dddddddd.md", handoff("open")),
    file("handoff-2026-11-05-selfself.md", handoff("open")),
    file("handoff-2026-11-06-eeeeeeee.md", handoff("claimed", "2026-11-06 outra")),
    file("handoff-2026-11-07-ffffffff.md", handoff("claimed", "2026-11-07 selfself-1234")),
  ];
  const { fresh, carried } = selectHandoffs(files, "selfself-1234");
  expect(fresh.map((f) => f.file)).toEqual([
    "handoff-2026-11-04-dddddddd.md",
    "handoff-2026-11-03-cccccccc.md",
    "handoff-2026-11-02-bbbbbbbb.md",
  ]);
  expect(carried.map((f) => f.file)).toEqual(["handoff-2026-11-07-ffffffff.md"]);
});

test("formatInjection devolve undefined sem resumos e traz o título com eles", () => {
  expect(formatInjection([])).toBeUndefined();
  expect(formatInjection([{ file: "h.md", body: "texto" }])).toStartWith("## Resumo da sessão anterior neste projeto");
});

test("as regras entregues pelo mod não mandam ler nem escrever handoff", () => {
  expect(AGENT_RULES_TEXT).toContain("chega sozinho");
  expect(AGENT_RULES_TEXT).not.toContain("No começo");
  expect(AGENT_RULES_TEXT).not.toContain("Fim de sessão");
});
