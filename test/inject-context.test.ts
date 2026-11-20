import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELIVERED_MARK, projectSlug } from "../mod/hooks/handoff-rules";
import { answer, contextFor, DELIVERED, summaryPath } from "../mod/hooks/inject-context.mjs";

// O hook de comando é o único canal que o cc-plugin-sec-default deixa chegar ao modelo (medido em 2026-11-20):
// ele entrega as regras na abertura e o resumo preparado pelo mod no primeiro prompt.
const SESSION: string = "abcdef12-3456";
const CWD: string = "/repo/x";

interface Disk {
  readonly home: string;
  readonly done: () => void;
}

function disk(): Disk {
  const home: string = mkdtempSync(join(tmpdir(), "hm-inject-"));
  return { home, done: (): void => rmSync(home, { recursive: true, force: true }) };
}

function prompt(home: string): string | undefined {
  return contextFor({ hook_event_name: "UserPromptSubmit", session_id: SESSION, cwd: CWD }, home);
}

function seed(home: string, text: string): string {
  const path: string = summaryPath(home, CWD, SESSION);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

test("a abertura da sessão recebe as regras do Hypermemory, de qualquer origem", (): void => {
  for (const source of ["startup", "resume", "clear", "compact"]) {
    const text: string | undefined = contextFor(
      { hook_event_name: "SessionStart", source, session_id: SESSION, cwd: CWD },
      "/h",
    );
    expect(text).toContain("## Memória (Hypermemory)");
  }
});

test("o primeiro prompt recebe o resumo preparado pelo mod, e só ele", (): void => {
  const { home, done } = disk();
  try {
    const path: string = seed(home, "## Resumo da sessão anterior\n\nOnde parou: notas.txt");
    expect(path).toBe(`${home}/.claude/hypermemory/sessoes/-repo-x/.resumo-${SESSION}.md`);
    expect(prompt(home)).toContain("notas.txt");
    expect(prompt(home)).toBeUndefined();
    expect(readFileSync(path, "utf8")).toContain("notas.txt");
  } finally {
    done();
  }
});

test("sem resumo preparado o prompt segue sem contexto extra", (): void => {
  const { home, done } = disk();
  try {
    expect(prompt(home)).toBeUndefined();
  } finally {
    done();
  }
});

test("evento que o hook não trata não ganha contexto", (): void => {
  expect(contextFor({ hook_event_name: "Stop", session_id: SESSION, cwd: CWD }, "/h")).toBeUndefined();
});

function run(input: string, home: string): string {
  const result = Bun.spawnSync(["node", "mod/hooks/inject-context.mjs"], {
    stdin: Buffer.from(input),
    env: { ...process.env, HOME: home },
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

test("rodado pelo Claude Code, imprime o JSON do hook com o contexto", (): void => {
  const out: string = run(
    JSON.stringify({ hook_event_name: "SessionStart", source: "startup", session_id: SESSION, cwd: CWD }),
    "/h",
  );
  const parsed = JSON.parse(out);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("## Memória (Hypermemory)");
});

test("entrada quebrada não trava a sessão: sai 0 e não imprime nada", (): void => {
  expect(run("{não é json", "/h")).toBe("");
});

test("a resposta em processo traz o JSON do hook e fica vazia sem contexto ou com entrada quebrada", (): void => {
  const out: string = answer(JSON.stringify({ hook_event_name: "SessionStart", session_id: SESSION, cwd: CWD }), "/h");
  expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(answer(JSON.stringify({ hook_event_name: "Stop", session_id: SESSION, cwd: CWD }), "/h")).toBe("");
  expect(answer("{quebrado", "/h")).toBe("");
});

test("pasta de projeto com caminho longo fica dentro do limite de 255 bytes e igual nos dois lados", (): void => {
  const long: string = `/repo/${"a".repeat(150)}/${"b".repeat(140)}`;
  const slug: string = projectSlug(long);
  expect(Buffer.byteLength(slug)).toBeLessThanOrEqual(255);
  expect(projectSlug(`${long}x`)).not.toBe(slug);
  expect(summaryPath("/h", long, SESSION)).toBe(`/h/.claude/hypermemory/sessoes/${slug}/.resumo-${SESSION}.md`);
  expect(projectSlug("/mnt/xs1000/me/my.repo")).toBe("-mnt-xs1000-me-my-repo");
});

test("a marca de entregue é a mesma no hook e no mod", (): void => {
  expect(DELIVERED).toBe(DELIVERED_MARK);
});
