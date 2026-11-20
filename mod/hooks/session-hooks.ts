import type { Register } from "claude-code";
import { HAIKU_SUMMARY, type TranscriptMessage } from "./handoff-rules";
import { prepareSummary, type SessionIo, writeCheckpoint } from "./session-flow";

type On = Parameters<Register>[0];
type Api = Parameters<Parameters<On>[2]>[0];

// Abaixo disso o exit está por estourar o limite do session.end: pula o checkpoint em vez de atrasar a saída.
const MIN_END_BUDGET_MS: number = 300;

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
    stamp: async (): Promise<string> => {
      const now: Date = new Date(await $.clock.now());
      return `${now.toLocaleDateString("sv-SE")}-${now.toLocaleTimeString("sv-SE").replaceAll(":", "")}`;
    },
  };
}

async function checkpoint($: Api, sessionId: string): Promise<void> {
  const messages: TranscriptMessage[] = await $.session.messages();
  await writeCheckpoint(ioOf($), sessionId, messages);
}

export function registerSessionHooks(on: On): void {
  // O resumo da sessão anterior fica pronto antes do primeiro prompt, que o hook de comando entrega
  // (inject-context.mjs): o cc-plugin-sec-default pula o prompt.compose dos mods.
  on("session.start", async ($, e, next) => {
    await prepareSummary(ioOf($), await $.session.id());
    return next(e);
  }).catch((_$, e, next) => next(e)); // falha daqui não trava a abertura: a sessão começa sem o resumo

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
