import type { Register } from "claude-code";
import { AGENT_RULES_SECTION_ID, AGENT_RULES_TEXT } from "./agent-rules";
import { HAIKU_SUMMARY, type TranscriptMessage } from "./handoff-rules";
import { loadPrevious, type SessionIo, writeCheckpoint } from "./session-flow";

type On = Parameters<Register>[0];
type Api = Parameters<Parameters<On>[2]>[0];

const PREVIOUS_SECTION_ID: string = "hypermemory-escopo:previous-session";
// Abaixo disso o exit está por estourar o limite do session.end: pula o checkpoint em vez de atrasar a saída.
const MIN_END_BUDGET_MS: number = 300;

// Uma carga por sessão: o texto injetado fica estável entre prompts (cache do prompt) e o modelo é chamado uma vez.
const previousBySession: Map<string, Promise<string | undefined>> = new Map();

function ioOf($: Api): SessionIo {
  return {
    home: async (): Promise<string> => (await $.env.get("HOME")) ?? "",
    cwd: (): Promise<string> => $.session.cwd(),
    readFile: (path: string): Promise<string> => $.fs.read(path),
    writeFile: (path: string, text: string): Promise<void> => $.fs.write(path, text),
    listFiles: async (dir: string): Promise<string[]> => {
      const entries = await $.fs.list(dir).catch(() => []);
      return entries.filter((entry) => entry.kind === "file").map((entry) => entry.name);
    },
    summarize: async (system: string, prompt: string): Promise<string | undefined> => {
      const result = await $.model.complete({ ...HAIKU_SUMMARY, system, prompt });
      return result.isAnswered ? result.text : undefined;
    },
    today: async (): Promise<string> => new Date(await $.clock.now()).toLocaleDateString("sv-SE"),
  };
}

function previousOnce($: Api, sessionId: string): Promise<string | undefined> {
  const known: Promise<string | undefined> | undefined = previousBySession.get(sessionId);
  if (known !== undefined) return known;
  const loading: Promise<string | undefined> = loadPrevious(ioOf($), sessionId).catch(() => undefined);
  previousBySession.set(sessionId, loading);
  return loading;
}

async function checkpoint($: Api, sessionId: string): Promise<void> {
  const messages: TranscriptMessage[] = await $.session.messages();
  await writeCheckpoint(ioOf($), sessionId, messages);
}

export function registerSessionHooks(on: On): void {
  // Regras e resumo da sessão anterior entram no prompt do sistema, sem CLAUDE.md. `bare` e `analysis` não enviam prompt.
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    if (e.traits.includes("bare") || e.traits.includes("analysis")) return composed;
    const rules = { id: AGENT_RULES_SECTION_ID, text: AGENT_RULES_TEXT, scope: "session" } as const;
    const previous: string | undefined = await previousOnce($, await $.session.id());
    const extra =
      previous === undefined ? [] : [{ id: PREVIOUS_SECTION_ID, text: previous, scope: "session" } as const];
    return { sections: [...composed.sections, rules, ...extra] };
  }).catch((_$, e, next) => next(e)); // falha daqui não trava a sessão: o prompt sai sem as seções

  // Só o agente principal: o subagente não tem sessão própria a lembrar.
  on("turn.complete", async ($, e, next) => {
    if (e.agentId === undefined) await checkpoint($, await $.session.id());
    return next(e);
  }).catch((_$, e, next) => next(e)); // sessão que cai sem fechar fica com o último checkpoint; falha não trava o turno

  on("session.end", async ($, e, next) => {
    if (next.budget.remainingMs >= MIN_END_BUDGET_MS) await checkpoint($, e.sessionId);
    return next(e);
  }).catch((_$, e, next) => next(e)); // saída nunca espera nem falha por causa do handoff
}
