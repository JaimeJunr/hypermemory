import { formatVersionIssue, MEMORY_INDEX, readFormat } from "./format";
import { type MemoryFile, validateFrontmatter } from "./frontmatter";
import { isDomainIndex, validateIndexBudget, validateIndexLinks } from "./indexes";
import type { Issue } from "./issue";
import { validateLogHistory, validateLogLines } from "./log";
import { validateHandoffs, validateSupersedes } from "./status";

export type { Issue } from "./issue";

export interface MemoryReader {
  list(): readonly string[];
  read(file: string): string;
}

export interface PreviousLogReader {
  read(): string | undefined;
}

export interface ValidationResult {
  readonly issues: readonly Issue[];
  readonly memoryFiles: number;
  readonly indexLines: number;
}

function isMemoryFile(file: string): boolean {
  const isReserved: boolean = file === MEMORY_INDEX || file === "LOG.md" || isDomainIndex(file);
  return file.endsWith(".md") && !isReserved;
}

function loadIndexes(reader: MemoryReader, files: readonly string[]): Map<string, string> {
  const indexes: Map<string, string> = new Map();
  if (files.includes(MEMORY_INDEX)) indexes.set(MEMORY_INDEX, reader.read(MEMORY_INDEX));
  for (const file of files.filter(isDomainIndex)) {
    indexes.set(file, reader.read(file));
  }
  return indexes;
}

export function validateMemory(
  reader: MemoryReader,
  previousLog: PreviousLogReader,
  directory?: string,
): ValidationResult {
  const issues: Issue[] = [];
  const files: string[] = [...reader.list()].sort();
  const indexes: Map<string, string> = loadIndexes(reader, files);
  const index: string = indexes.get(MEMORY_INDEX) ?? "";
  const formatIssue: Issue | undefined = formatVersionIssue(readFormat(index), directory);
  if (formatIssue !== undefined) issues.push(formatIssue);
  const indexLines: number = validateIndexBudget(index, issues);
  const memories: MemoryFile[] = files
    .filter(isMemoryFile)
    .map((file: string): MemoryFile => validateFrontmatter(file, reader.read(file), issues));
  validateIndexLinks(indexes, new Set(files), memories, issues);
  validateSupersedes(memories, issues);
  validateHandoffs(memories, issues);
  const log: string = files.includes("LOG.md") ? reader.read("LOG.md") : "";
  validateLogLines(log, issues);
  validateLogHistory(log, previousLog.read(), issues);
  return { issues, memoryFiles: memories.length, indexLines };
}
