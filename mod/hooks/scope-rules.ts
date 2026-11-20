// Regras puras do mod hypermemory-escopo, sem API do Claude Code: o bun test do repositório as testa
// contra o validador (test/mod-contract.test.ts), para as duas noções de "pessoal" não divergirem.

const SCOPE_LINE: RegExp = /^<!--\s*hypermemory-scope:\s*(personal|project|shared)\s*-->$/;
const FRONTMATTER: RegExp = /^﻿?---[ \t]*\r?\n([\s\S]*?)(?<=\n)---[ \t]*(?:\r?\n|$)/;
// No texto de um comando o frontmatter vem com \n escapado (printf, echo -e), sem início de linha.
const PERSONAL_IN_COMMAND: RegExp = /(type:\s*["']?user|kind:\s*["']?profile|personal:\s*true)\b/;
const REDIRECT_TARGET: RegExp = /(?:>>?|\btee\s+(?:-a\s+)?)\s*(["']?)([^\s"'|;&<>]+\.md)\1/g;
const COPY_COMMAND: RegExp = /\b(?:cp|mv|install)\s+([^|;&\n]+)/g;
const ASSIGNMENT: RegExp = /(?:^|[\s;&|(])(?:export\s+)?([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|]*))/g;
const VARIABLE: RegExp = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;

export type Metadata = ReadonlyMap<string, string>;

export interface CopyTarget {
  readonly source: string;
  readonly destination: string;
}

export function scopeFromIndex(index: string): string | undefined {
  return SCOPE_LINE.exec((index.split(/\r?\n/)[1] ?? "").trim())?.[1];
}

function unquote(value: string): string {
  const quoted: RegExpExecArray | null = /^(["'])(.*)\1$/.exec(value);
  return quoted === null ? value : `"${quoted[2] ?? ""}"`;
}

function parsePair(pair: string, fields: Map<string, string>): void {
  const match: RegExpExecArray | null = /^\s*([A-Za-z_]\w*)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(pair);
  if (match?.[1] !== undefined) fields.set(match[1], unquote(match[2] ?? ""));
}

// Lê metadata em bloco (metadata:\n  type: user) ou em fluxo (metadata: {type: user}); valor entre aspas fica marcado.
export function readMetadata(content: string): Metadata {
  const fields: Map<string, string> = new Map();
  const lines: string[] = (FRONTMATTER.exec(content)?.[1] ?? "").split(/\r?\n/);
  const start: number = lines.findIndex((line: string): boolean => /^metadata\s*:/.test(line));
  if (start < 0) return fields;
  const flow: RegExpExecArray | null = /^metadata\s*:\s*\{(.*)\}\s*$/.exec(lines[start] ?? "");
  if (flow !== null) {
    for (const pair of (flow[1] ?? "").split(",")) parsePair(pair, fields);
    return fields;
  }
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    parsePair(line, fields);
  }
  return fields;
}

function plain(metadata: Metadata, key: string): string | undefined {
  return metadata.get(key)?.replace(/^"(.*)"$/, "$1");
}

// Mesmo critério de personalField em src/validator.ts.
export function isPersonalContent(content: string): boolean {
  const metadata: Metadata = readMetadata(content);
  const type: string | undefined = plain(metadata, "type");
  if (type === "user" || plain(metadata, "kind") === "profile") return true;
  return type === "feedback" && metadata.get("personal") === "true";
}

export function applyEdit(content: string, oldText: string, newText: string, replaceAll: boolean): string {
  return replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, (): string => newText);
}

export function mentionsPersonal(command: string): boolean {
  return PERSONAL_IN_COMMAND.test(command);
}

// Resolve variável definida no próprio comando (S=/x; ... > "$S/a.md"); a que vem de fora fica com o validador.
export function expandVariables(command: string): string {
  const values: Map<string, string> = new Map();
  for (const match of command.matchAll(ASSIGNMENT)) values.set(match[1] ?? "", match[2] ?? match[3] ?? match[4] ?? "");
  return command.replace(VARIABLE, (whole: string, braced?: string, bare?: string): string => {
    return values.get(braced ?? bare ?? "") ?? whole;
  });
}

export function absolute(path: string, cwd: string): string {
  return path.startsWith("/") ? path : `${cwd}/${path.replace(/^\.\//, "")}`;
}

export function redirectTargets(command: string, cwd: string): string[] {
  if (!mentionsPersonal(command)) return [];
  return [...command.matchAll(REDIRECT_TARGET)].map((match: RegExpExecArray): string => absolute(match[2] ?? "", cwd));
}

// cp/mv/install: o destino é o último argumento; pasta de destino recebe o arquivo com o nome da origem.
export function copyTargets(command: string, cwd: string): CopyTarget[] {
  const targets: CopyTarget[] = [];
  for (const match of command.matchAll(COPY_COMMAND)) {
    const args: string[] = (match[1] ?? "")
      .trim()
      .split(/\s+/)
      .filter((arg: string): boolean => !arg.startsWith("-"));
    const destination: string = absolute(args.pop() ?? "", cwd);
    for (const source of args.filter((arg: string): boolean => arg.endsWith(".md"))) {
      const from: string = absolute(source, cwd);
      const name: string = from.slice(from.lastIndexOf("/") + 1);
      const to: string = destination.endsWith(".md") ? destination : `${destination.replace(/\/$/, "")}/${name}`;
      targets.push({ source: from, destination: to });
    }
  }
  return targets;
}

export function dirOf(filePath: string): string {
  return filePath.slice(0, filePath.lastIndexOf("/"));
}
