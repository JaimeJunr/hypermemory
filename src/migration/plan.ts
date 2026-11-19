import { formatIssue } from "../cli";
import { type MemoryFile, nonEmptyString, validateFrontmatter } from "../frontmatter";
import { isDomainIndex } from "../indexes";
import type { Issue } from "../issue";
import { appendLines, markdownLines } from "../markdown";
import type { MemoryReader } from "../validator";
import { type IndexEdit, type IndexPage, planIndexes } from "./index-plan";
import type { OptMemRecords } from "./optmem";
import { type ConvertedPages, convertPages, type MigratedPage, type NamedPage, pageOrigin } from "./pages";
import type { ProjectPages, Skipped } from "./wiki";

export interface FileChange {
  readonly file: string;
  readonly before: string | undefined;
  readonly content: string;
}

export interface Skeleton {
  readonly memory: string;
  readonly log: string;
}

export interface MigrationPlan {
  readonly files: readonly FileChange[];
  readonly skips: readonly Skipped[];
  readonly issues: readonly Issue[];
  readonly logLines: readonly string[];
  readonly indexes: readonly IndexEdit[];
}

const INDEX: string = "MEMORY.md";
const LOG: string = "LOG.md";

function loadDestination(reader: MemoryReader, files: ReadonlySet<string>): Map<string, string> {
  const indexes: Map<string, string> = new Map();
  for (const file of files) {
    if (file === INDEX || file === LOG || isDomainIndex(file)) indexes.set(file, reader.read(file));
  }
  return indexes;
}

function changedFiles(old: ReadonlyMap<string, string>, updated: ReadonlyMap<string, string>): FileChange[] {
  const changes: FileChange[] = [];
  for (const [file, content] of updated) {
    const before: string | undefined = old.get(file);
    if (before !== content) changes.push({ file, before, content });
  }
  return changes;
}

function fillSkeleton(files: Map<string, string>, skeleton: Skeleton): void {
  if (!files.has(INDEX)) files.set(INDEX, skeleton.memory);
  if (!files.has(LOG)) files.set(LOG, skeleton.log);
}

function newLogLines(content: string, records: OptMemRecords, skips: Skipped[]): string[] {
  const seen: Set<string> = new Set(markdownLines(content));
  const lines: string[] = [];
  for (const line of records.lines) {
    if (seen.has(line)) skips.push({ target: line, reason: "LOG line already exists" });
    else {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

export function planOptMem(reader: MemoryReader, records: OptMemRecords, skeleton: Skeleton): MigrationPlan {
  const old: Map<string, string> = loadDestination(reader, new Set(reader.list()));
  const files: Map<string, string> = new Map(old);
  fillSkeleton(files, skeleton);
  const log: string = files.get(LOG) ?? "";
  const skips: Skipped[] = records.issues.map((): Skipped => ({ target: "LOG.txt", reason: "invalid record" }));
  for (let index: number = 0; index < records.skipped; index++)
    skips.push({ target: "LOG.txt", reason: "empty record" });
  const logLines: string[] = newLogLines(log, records, skips);
  files.set(LOG, appendLines(log, logLines));
  return { files: changedFiles(old, files), skips, issues: records.issues, logLines, indexes: [] };
}

function recoverIndexPage(reader: MemoryReader, page: NamedPage, project: string): IndexPage | undefined {
  const file: string = `${page.name}.md`;
  const issues: Issue[] = [];
  const parsed: MemoryFile = validateFrontmatter(file, reader.read(file), issues);
  if (
    issues.length > 0 ||
    parsed.metadata.origin !== pageOrigin(project, page.path) ||
    parsed.metadata.status === "superseded" ||
    !nonEmptyString(parsed.description)
  )
    return undefined;
  const title: string = nonEmptyString(page.fields.title) ? page.fields.title.trim().replace(/\s+/g, " ") : page.name;
  return { name: page.name, kind: page.kind, title, description: parsed.description.trim().replace(/\s+/g, " ") };
}

function indexPages(reader: MemoryReader, converted: ConvertedPages, project: string): IndexPage[] {
  const pages: IndexPage[] = converted.pages.filter((page: MigratedPage): boolean => !page.superseded);
  for (const page of converted.existing) {
    const pending: IndexPage | undefined = recoverIndexPage(reader, page, project);
    if (pending !== undefined) pages.push(pending);
  }
  return pages;
}

export function planWiki(
  reader: MemoryReader,
  source: ProjectPages,
  project: string,
  skeleton: Skeleton,
): MigrationPlan {
  const names: ReadonlySet<string> = new Set(reader.list());
  const old: Map<string, string> = loadDestination(reader, names);
  const files: Map<string, string> = new Map();
  const converted: ConvertedPages = convertPages(source.pages, project, names);
  for (const page of converted.pages) files.set(`${page.name}.md`, page.content);
  const indexes: Map<string, string> = new Map(old);
  fillSkeleton(indexes, skeleton);
  const edits: IndexEdit[] = planIndexes(indexes, indexPages(reader, converted, project));
  if (!old.has(LOG)) files.set(LOG, skeleton.log);
  if (!old.has(INDEX) && !edits.some(({ file }): boolean => file === INDEX)) files.set(INDEX, skeleton.memory);
  for (const { file, content } of edits) files.set(file, content);
  return {
    files: changedFiles(old, files),
    skips: [...source.skips, ...converted.skips],
    issues: [...source.issues, ...converted.issues],
    logLines: [],
    indexes: edits,
  };
}

function skipCounts(skips: readonly Skipped[]): string[] {
  const counts: Map<string, number> = new Map();
  for (const { reason } of skips) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].sort().map(([reason, count]: [string, number]): string => `  ${reason}: ${count}`);
}

function summarize(plan: MigrationPlan): string {
  const creates: number = plan.files.filter((file: FileChange): boolean => file.before === undefined).length;
  const indexLines: number = plan.indexes.reduce(
    (total: number, index: IndexEdit): number => total + index.lines.length,
    0,
  );
  return (
    "Summary: " +
    creates +
    " files to create, " +
    (plan.files.length - creates) +
    " files to update, " +
    plan.skips.length +
    " items skipped, " +
    plan.logLines.length +
    " LOG lines to append, " +
    indexLines +
    " index lines, " +
    plan.issues.length +
    " warnings"
  );
}

export function describePlan(plan: MigrationPlan, apply: boolean): string[] {
  const output: string[] = [apply ? "Apply" : "Dry run"];
  for (const { file, before } of plan.files)
    output.push((before === undefined ? "Create file: " : "Update file: ") + file);
  for (const skip of plan.skips) output.push(`Skip: ${skip.target.replaceAll(/[\r\n]/g, " ")} (${skip.reason})`);
  for (const issue of plan.issues) output.push(`Warning: ${formatIssue(issue)}`);
  for (const line of plan.logLines) output.push(`Append LOG.md: ${line}`);
  for (const index of plan.indexes) {
    for (const line of index.lines) output.push(`Index ${index.file}: ${line}`);
  }
  output.push(summarize(plan), ...skipCounts(plan.skips));
  return output;
}
