// Fluxo do handoff automático (checkpoint por turno e resumo na abertura), atrás de uma interface de E/S
// para o bun test rodar sem o Claude Code. Os resumos moram sempre na pasta pessoal, nunca na memory/ do
// projeto: repo de time é versionado.

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

async function readEntries(io: SessionIo, dir: string): Promise<HandoffFile[]> {
  const names: string[] = newestHandoffNames(await io.listFiles(dir));
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

async function claim(io: SessionIo, dir: string, entry: HandoffFile, sessionId: string): Promise<InjectedSummary> {
  const parsed = parseHandoff(entry.content);
  const rewritten: string | undefined = parsed.consolidated ? undefined : await rewrite(io, parsed.body);
  const body: string = rewritten ?? parsed.body;
  const consolidated: string =
    rewritten === undefined ? entry.content : setField(replaceBody(entry.content, body), "consolidated", "true");
  const claimedBy: string = `${await io.today()} ${sessionId}`;
  await io.writeFile(`${dir}/${entry.file}`, claimedContent(consolidated, claimedBy)).catch(() => undefined);
  return { file: entry.file, body };
}

// Resumo a injetar no contexto: handoffs abertos de sessões anteriores (reescritos e pegos agora) e os que esta
// sessão já pegou (mesmo texto, sem nova chamada ao modelo).
export async function loadPrevious(io: SessionIo, sessionId: string): Promise<string | undefined> {
  const dir: string = await sessionDir(io);
  const { fresh, carried } = selectHandoffs(await readEntries(io, dir), sessionId);
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
