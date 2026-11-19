import { join } from "node:path";
import { formatIssue, runCli, type MemorySources } from "./cli";
import { receivedIssue } from "./issue";
import { parseMigrationOptions, type MigrationOptions } from "./migration/args";
import { DiskMigrationIO } from "./migration/disk";
import { readOptMemRecords } from "./migration/optmem";
import { describePlan, planOptMem, planWiki, type FileChange, type MigrationPlan, type Skeleton } from "./migration/plan";
import { findProjects, readProject, type WikiEntry, type WikiProject, type WikiReader } from "./migration/wiki";

export interface MigrationSource extends WikiReader {
  bytes(file: string): Uint8Array;
}

export interface MigrationDestination extends MemorySources {
  apply(changes: readonly FileChange[]): void;
}

export interface MigrationIO {
  readonly home: string;
  readonly memoryDir?: string;
  readonly skeleton: Skeleton;
  readonly source: MigrationSource;
  destination(directory: string, source: string): MigrationDestination;
}

interface MigrationResult {
  readonly exitCode: 0 | 1;
  readonly output: readonly string[];
}

interface ProjectCount {
  readonly name: string;
  readonly count: number;
}

function selectProject(projects: readonly WikiProject[], name: string): WikiProject {
  const matches: WikiProject[] = projects.filter((project: WikiProject): boolean => project.name === name);
  const [match] = matches;
  if (matches.length === 1 && match !== undefined) return match;
  const expected: string = matches.length > 1
    ? "a unique project name (found in " + matches.map(({ directory }): string => JSON.stringify(directory)).join(", ") + ")"
    : "one of " + JSON.stringify([...new Set(projects.map(({ name }): string => name))].sort());
  throw new Error(receivedIssue("ai-memory", "--project", name, expected).message);
}

function listProjects(reader: WikiReader, projects: readonly WikiProject[]): MigrationResult {
  const counts: ProjectCount[] = projects.map((project: WikiProject): ProjectCount => ({
    name: project.name, count: readProject(reader, project).pages.length,
  }));
  counts.sort((a: ProjectCount, b: ProjectCount): number => b.count - a.count || a.name.localeCompare(b.name));
  const output: string[] = counts.map(({ name, count }): string => name.replace(/[\r\n\t]/g, " ") + "\t" + count);
  return { exitCode: 0, output };
}

function optMemBytes(source: MigrationSource, directory: string): Uint8Array {
  const entries: readonly WikiEntry[] | undefined = source.entries(directory);
  if (entries === undefined) throw new Error(receivedIssue(directory, "--from", directory, "an OptMem directory").message);
  const log: WikiEntry | undefined = entries.find(({ name }): boolean => name === "LOG.txt");
  if (log === undefined) return new Uint8Array(0);
  const file: string = join(directory, log.name);
  const expected: string = "a readable 320-byte record log";
  if (log.directory) throw new Error(formatIssue(receivedIssue(file, "source file", file, expected)));
  try {
    return source.bytes(file);
  } catch (error: unknown) {
    throw new Error(formatIssue(receivedIssue(file, "source file", errorText(error), expected)));
  }
}

function applyPlan(
  options: Extract<MigrationOptions, { list: false }>, plan: MigrationPlan, destination: MigrationDestination,
): MigrationResult {
  const output: string[] = describePlan(plan, options.apply);
  if (!options.apply) return { exitCode: 0, output };
  try {
    if (plan.files.length > 0) destination.apply(plan.files);
  } catch (error: unknown) {
    const message: string = formatIssue(receivedIssue(options.dest, "apply", errorText(error), "a writable, unchanged destination directory"));
    return { exitCode: 1, output: [...output, message] };
  }
  const validation: ReturnType<typeof runCli> = runCli([options.dest], (): MemorySources => destination);
  return { exitCode: validation.exitCode, output: [...output, ...validation.output] };
}

function migrateWiki(options: Extract<MigrationOptions, { kind: "ai-memory" }>, io: MigrationIO): MigrationResult {
  const projects: WikiProject[] = findProjects(io.source, options.from);
  if (options.list) return listProjects(io.source, projects);
  const project: WikiProject = selectProject(projects, options.project);
  const destination: MigrationDestination = io.destination(options.dest, options.from);
  const plan: MigrationPlan = planWiki(destination.reader, readProject(io.source, project), project.name, io.skeleton);
  return applyPlan(options, plan, destination);
}

function errorText(error: unknown): string {
  const message: string = error instanceof Error ? error.message : String(error);
  return message;
}

export function runMigration(args: readonly string[], io: MigrationIO): MigrationResult {
  try {
    const options: MigrationOptions = parseMigrationOptions(args, io);
    if (options.kind === "ai-memory") return migrateWiki(options, io);
    const bytes: Uint8Array = optMemBytes(io.source, options.from);
    const destination: MigrationDestination = io.destination(options.dest, options.from);
    const plan: MigrationPlan = planOptMem(destination.reader, readOptMemRecords(bytes), io.skeleton);
    return applyPlan(options, plan, destination);
  } catch (error: unknown) {
    return { exitCode: 1, output: [errorText(error)] };
  }
}

if (import.meta.main) {
  const result: MigrationResult = runMigration(Bun.argv.slice(2), new DiskMigrationIO());
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
