import { type Issue, receivedIssue } from "./issue";

export const CURRENT_FORMAT: number = 1;
export const MEMORY_INDEX: string = "MEMORY.md";
const FORMAT_MARKER: RegExp = /^<!-- hypermemory-format: (\d+) -->$/;
const SCOPE_MARKER: RegExp = /^<!-- hypermemory-scope: (.*) -->$/;
const SCOPE_PREFIX: RegExp = /^[ \t]*<!--[ \t]*hypermemory-scope(?=[: \t]|-->|$)[ \t]*:?[ \t]*/;
const SCOPE_NAMES = ["personal", "project", "shared"] as const;
export type MemoryScope = (typeof SCOPE_NAMES)[number];
export const SCOPE_VALUES: string = SCOPE_NAMES.join("|");

export function formatMarker(version: number): string {
  return `<!-- hypermemory-format: ${version} -->`;
}

export function readFormat(content: string): bigint | undefined {
  const firstLine: string = content.split(/[\r\n]/, 1)[0] ?? "";
  const version: string | undefined = FORMAT_MARKER.exec(firstLine)?.[1];
  return version === undefined ? undefined : BigInt(version);
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  return SCOPE_NAMES.some((scope: MemoryScope): boolean => value === scope);
}

export function scopeMarker(scope: MemoryScope): string {
  return `<!-- hypermemory-scope: ${scope} -->`;
}

function secondLine(index: string): string {
  return index.split(/\r\n|[\r\n]/, 2)[1] ?? "";
}

export function declaredScope(index: string): MemoryScope | undefined {
  const value: string | undefined = SCOPE_MARKER.exec(secondLine(index))?.[1];
  return isMemoryScope(value) ? value : undefined;
}

export function readScope(memoryIndex: string): MemoryScope {
  return declaredScope(memoryIndex) ?? "project";
}

export function scopeMarkerIssue(index: string): Issue | undefined {
  const line: string = secondLine(index);
  const prefix: string | undefined = SCOPE_PREFIX.exec(line)?.[0];
  if (prefix === undefined || declaredScope(index) !== undefined) return undefined;
  const value: string = SCOPE_MARKER.exec(line)?.[1] ?? line.slice(prefix.length).replace(/[ \t]*-->[ \t]*$/, "");
  return { ...receivedIssue(MEMORY_INDEX, "scope", value, `one of ${SCOPE_VALUES}`), line: 2 };
}

export function insertScopeMarker(index: string, scope: MemoryScope): string {
  const boundary: RegExpExecArray | null = /\r\n|[\r\n]/.exec(index);
  const newline: string = boundary?.[0] ?? "\n";
  const end: number = boundary?.index ?? index.length;
  return index.slice(0, end) + newline + scopeMarker(scope) + newline + index.slice(end + newline.length);
}

function directoryArgument(directory: string): string {
  const path: string = directory.startsWith("-") ? `./${directory}` : directory;
  if (/^[\w./-]+$/.test(path)) return path;
  const quoted: string = path
    .replaceAll("'", "'\\''")
    .replaceAll("\r", (): string => "'$'\\r''")
    .replaceAll("\n", (): string => "'$'\\n''");
  return `'${quoted}'`;
}

function versionIssue(version: bigint | undefined, expected: string): Issue {
  return { file: MEMORY_INDEX, line: 1, message: `format: received ${version ?? "missing"}, expected ${expected}` };
}

export function newerFormatIssue(version: bigint): Issue {
  return versionIssue(version, `at most ${CURRENT_FORMAT}; update Hypermemory`);
}

export function formatVersionIssue(version: bigint | undefined, directory?: string): Issue | undefined {
  if (version === BigInt(CURRENT_FORMAT)) return undefined;
  if (version !== undefined && version > CURRENT_FORMAT) return newerFormatIssue(version);
  const path: string = directory === undefined ? "<dir>" : directoryArgument(directory);
  return versionIssue(version, `hypermemory-format ${CURRENT_FORMAT}; run hypermemory upgrade ${path}`);
}
