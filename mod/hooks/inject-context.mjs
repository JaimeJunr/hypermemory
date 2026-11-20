// Hook de comando do plugin (SessionStart e UserPromptSubmit): o cc-plugin-sec-default pula os hooks de mod
// (prompt.compose, classic.*) e deixa passar só o hook de comando, medido em 2026-11-20. JavaScript puro para
// rodar com o node, sem build: entrega as regras na abertura e, no primeiro prompt, o resumo que o mod preparou
// no session.start (session-flow.ts, prepareSummary).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DELIVERED = "<!-- hypermemory: entregue -->";
const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "agent-rules.md");

/** @param {string} cwd */
function projectSlug(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** Mesmo caminho que o mod grava (session-flow.ts, summaryFile). @param {string} home @param {string} cwd @param {string} sessionId */
export function summaryPath(home, cwd, sessionId) {
  return `${home}/.claude/hypermemory/sessoes/${projectSlug(cwd)}/.resumo-${sessionId}.md`;
}

/** @param {string} path @returns {string | undefined} */
function readOrUndefined(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

// O resumo vai uma vez só; a marca fica no arquivo, que continua lá para conferência.
/** @param {string} path @returns {string | undefined} */
function deliverOnce(path) {
  const text = readOrUndefined(path);
  if (text === undefined || text.startsWith(DELIVERED)) return undefined;
  writeFileSync(path, `${DELIVERED}\n${text}`);
  return text;
}

/**
 * @param {{ hook_event_name: string, session_id: string, cwd: string, source?: string }} input
 * @param {string} home
 * @returns {string | undefined} o additionalContext, ou undefined para não acrescentar nada
 */
export function contextFor(input, home) {
  if (input.hook_event_name === "SessionStart") return readOrUndefined(RULES_PATH);
  if (input.hook_event_name !== "UserPromptSubmit") return undefined;
  return deliverOnce(summaryPath(home, input.cwd, input.session_id));
}

/**
 * Resposta do hook para a entrada crua do stdin: o JSON a imprimir, ou "" para não acrescentar nada.
 * @param {string} raw @param {string} home @returns {string}
 */
export function answer(raw, home) {
  try {
    const input = JSON.parse(raw);
    const context = contextFor(input, home);
    if (context === undefined) return "";
    return JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context } });
  } catch {
    return ""; // falha aqui nunca trava a sessão: o prompt segue sem o contexto
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(answer(readFileSync(0, "utf8"), process.env.HOME ?? ""));
