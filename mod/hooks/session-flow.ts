// Fluxo do handoff automático (checkpoint por turno e resumo na abertura), atrás de uma interface de E/S
// para o bun test rodar sem o Claude Code. Os resumos moram sempre na pasta pessoal, nunca na memory/ do
// projeto: repo de time é versionado.

import { CAPTURE_SYSTEM, candidatesPrompt, formatCandidates, parseCandidates } from "./capture-rules";
import {
  buildBody,
  claimedContent,
  describeHandoff,
  formatInjection,
  HAIKU_SUMMARY,
  type HandoffFile,
  handoffName,
  type InjectedSummary,
  newestHandoffNames,
  parseHandoff,
  projectSlug,
  renderHandoff,
  replaceBody,
  selectHandoffs,
  setField,
  shortId,
  summaryPrompt,
  type TranscriptMessage,
  undeliveredSessions,
} from "./handoff-rules";

export interface SessionIo {
  home(): Promise<string>;
  cwd(): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  // Nomes dos arquivos da pasta; pasta que não existe responde [].
  listFiles(dir: string): Promise<string[]>;
  // Texto reescrito pelo modelo, ou undefined se não respondeu (erro, timeout, resposta vazia).
  summarize(system: string, prompt: string): Promise<string | undefined>;
  today(): Promise<string>;
  // AAAA-MM-DD-HHMMSS local: entra no nome do handoff para ordenar as sessões do mesmo dia.
  stamp(): Promise<string>;
}

async function sessionDir(io: SessionIo): Promise<string> {
  return `${await io.home()}/.claude/hypermemory/sessoes/${projectSlug(await io.cwd())}`;
}

// Reescreve no lugar o handoff desta sessão (mesmo id curto): data e hora do nome são as do primeiro turno.
export async function writeCheckpoint(
  io: SessionIo,
  sessionId: string,
  messages: readonly TranscriptMessage[],
): Promise<void> {
  const body: string | undefined = buildBody(messages);
  if (body === undefined) return;
  const dir: string = await sessionDir(io);
  const existing: string | undefined = (await io.listFiles(dir)).find((file: string): boolean =>
    file.endsWith(`-${shortId(sessionId)}.md`),
  );
  const name: string = existing?.replace(/\.md$/, "") ?? handoffName(await io.stamp(), sessionId);
  const slug: string = projectSlug(await io.cwd());
  const description: string = describeHandoff(messages, slug);
  await io.writeFile(`${dir}/${name}.md`, renderHandoff({ name, description, body }));
}

async function readEntries(io: SessionIo, dir: string, names: readonly string[]): Promise<HandoffFile[]> {
  const read = async (file: string): Promise<HandoffFile | undefined> =>
    io.readFile(`${dir}/${file}`).then(
      (content: string): HandoffFile => ({ file, content }),
      (): undefined => undefined,
    );
  const entries: (HandoffFile | undefined)[] = await Promise.all(names.map(read));
  return entries.filter((entry: HandoffFile | undefined): entry is HandoffFile => entry !== undefined);
}

// Texto por regra quando o modelo falha ou estoura o tempo: o resumo nunca fica de fora por causa dele.
async function rewrite(io: SessionIo, body: string): Promise<string | undefined> {
  const text: string | undefined = await io.summarize(HAIKU_SUMMARY.system, summaryPrompt(body)).catch(() => undefined);
  return text === undefined || text.trim() === "" ? undefined : text.trim();
}

// Candidatos a memória do registro: falha ou resposta vazia do modelo não deixa nada de fora do resumo.
async function capture(io: SessionIo, body: string): Promise<string> {
  const reply: string | undefined = await io.summarize(CAPTURE_SYSTEM, candidatesPrompt(body)).catch(() => undefined);
  return formatCandidates(parseCandidates(reply ?? ""));
}

async function claim(io: SessionIo, dir: string, entry: HandoffFile, sessionId: string): Promise<InjectedSummary> {
  const parsed = parseHandoff(entry.content);
  const [rewritten, candidates]: [string | undefined, string] = parsed.consolidated
    ? [undefined, ""]
    : await Promise.all([rewrite(io, parsed.body), capture(io, parsed.body)]);
  const body: string = rewritten === undefined ? parsed.body : [rewritten, candidates].filter(Boolean).join("\n\n");
  const consolidated: string =
    rewritten === undefined ? entry.content : setField(replaceBody(entry.content, body), "consolidated", "true");
  const claimedBy: string = `${await io.today()} ${sessionId}`;
  // A sessão dona pode ter gravado checkpoint enquanto o modelo resumia: aí o arquivo fica como ela deixou.
  const current: string | undefined = await io.readFile(`${dir}/${entry.file}`).catch(() => undefined);
  if (current !== entry.content) return { file: entry.file, body };
  await io.writeFile(`${dir}/${entry.file}`, claimedContent(consolidated, claimedBy)).catch(() => undefined);
  return { file: entry.file, body };
}

// Resumo a injetar no contexto: handoffs abertos de sessões anteriores (reescritos e pegos agora) e os que esta
// sessão já pegou (mesmo texto, sem nova chamada ao modelo).
export async function loadPrevious(io: SessionIo, sessionId: string): Promise<string | undefined> {
  const dir: string = await sessionDir(io);
  const files: string[] = await io.listFiles(dir);
  const summaries: HandoffFile[] = await readEntries(
    io,
    dir,
    files.filter((file: string) => file.startsWith(".resumo-")),
  );
  const handoffs: HandoffFile[] = await readEntries(io, dir, newestHandoffNames(files));
  const { fresh, carried } = selectHandoffs(handoffs, sessionId, undeliveredSessions(summaries));
  const kept: InjectedSummary[] = carried.map((entry: HandoffFile): InjectedSummary => {
    return { file: entry.file, body: parseHandoff(entry.content).body };
  });
  const claimed: InjectedSummary[] = await Promise.all(
    fresh.map((entry: HandoffFile): Promise<InjectedSummary> => claim(io, dir, entry, sessionId)),
  );
  return formatInjection([...kept, ...claimed]);
}

// O hook de comando (inject-context.mjs, summaryPath) lê este mesmo caminho no primeiro prompt: o ponto na frente
// tira o arquivo da lista de handoffs.
export function summaryFile(dir: string, sessionId: string): string {
  return `${dir}/.resumo-${sessionId}.md`;
}

// Roda no session.start: pega e reescreve os handoffs abertos e deixa o texto pronto para o hook de comando entregar.
export async function prepareSummary(io: SessionIo, sessionId: string): Promise<void> {
  const text: string | undefined = await loadPrevious(io, sessionId);
  if (text === undefined) return;
  await io.writeFile(summaryFile(await sessionDir(io), sessionId), text);
}
