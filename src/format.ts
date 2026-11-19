import type { Issue } from "./issue";

export const CURRENT_FORMAT: number = 1;
export const MEMORY_INDEX: string = "MEMORY.md";
const FORMAT_MARKER: RegExp = /^<!-- hypermemory-format: (\d+) -->$/;

export function formatMarker(version: number): string {
  return `<!-- hypermemory-format: ${version} -->`;
}

export function readFormat(content: string): bigint | undefined {
  const firstLine: string = content.split(/[\r\n]/, 1)[0] ?? "";
  const version: string | undefined = FORMAT_MARKER.exec(firstLine)?.[1];
  return version === undefined ? undefined : BigInt(version);
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
