import { join } from "node:path";
import { formatIssue, type MemorySources, runCli } from "./cli";
import { type MemoryScope, readScope } from "./format";
import { receivedIssue } from "./issue";
import { type MigrationOptions, parseMigrationOptions } from "./migration/args";
import { readCurrentIndex } from "./migration/destination-format";
import { DiskMigrationIO } from "./migration/disk";
import { readOptMemRecords } from "./migration/optmem";
import {
  describePlan,
  type FileChange,
  type MigrationPlan,
  planOptMem,
  planWiki,
  type Skeleton,
} from "./migration/plan";
import {
  findProjects,
  type ProjectPages,
  readProject,
  type Skipped,
  type WikiEntry,
  type WikiPage,
  type WikiProject,
  type WikiReader,
} from "./migration/wiki";
import { scopedSkeleton } from "./skeleton";

export interface MigrationSource extends WikiReader {
  bytes(file: string): Uint8Array;
}

export interface MigrationDestination extends MemorySources {
  readonly directory: string;
  exists(): boolean;
  apply(changes: readonly FileChange[], expectedIndex: string | undefined): void;
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

interface OpenDestination {
  readonly destination: MigrationDestination;
  readonly index: string | undefined;
  readonly scope: MemoryScope;
  readonly skeleton: Skeleton;
}

interface DestinationPlan extends OpenDestination {
  readonly plan: MigrationPlan;
}

type WikiOptions = Extract<MigrationOptions, { kind: "ai-memory"; list: false }>;

function selectProject(projects: readonly WikiProject[], name: string): WikiProject {
  const matches: WikiProject[] = projects.filter((project: WikiProject): boolean => project.name === name);
  const [match] = matches;
  if (matches.length === 1 && match !== undefined) return match;
  const expected: string =
    matches.length > 1
      ? `a unique project name (found in ${matches.map(({ directory }): string => JSON.stringify(directory)).join(", ")})`
      : `one of ${JSON.stringify([...new Set(projects.map(({ name }): string => name))].sort())}`;
  throw new Error(receivedIssue("ai-memory", "--project", name, expected).message);
}

function listProjects(reader: WikiReader, projects: readonly WikiProject[]): MigrationResult {
  const counts: ProjectCount[] = projects.map(
    (project: WikiProject): ProjectCount => ({
      name: project.name,
      count: readProject(reader, project).pages.length,
    }),
  );
  counts.sort((a: ProjectCount, b: ProjectCount): number => b.count - a.count || a.name.localeCompare(b.name));
  const output: string[] = counts.map(({ name, count }): string => `${name.replace(/[\r\n\t]/g, " ")}\t${count}`);
  return { exitCode: 0, output };
}

function optMemBytes(source: MigrationSource, directory: string): Uint8Array {
  const entries: readonly WikiEntry[] | undefined = source.entries(directory);
  if (entries === undefined)
    throw new Error(receivedIssue(directory, "--from", directory, "an OptMem directory").message);
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

function runPlan({ plan, destination, index }: DestinationPlan, apply: boolean): MigrationResult {
  const { directory }: MigrationDestination = destination;
  const output: string[] = describePlan(plan, apply, directory);
  if (!apply) return { exitCode: 0, output };
  try {
    if (plan.files.length > 0) destination.apply(plan.files, index);
  } catch (error: unknown) {
    const message: string = formatIssue(
      receivedIssue(directory, "apply", errorText(error), "a writable, unchanged destination directory"),
    );
    return { exitCode: 1, output: [...output, message] };
  }
  const validation: ReturnType<typeof runCli> = runCli([directory], (): MemorySources => destination);
  return { exitCode: validation.exitCode, output: [...output, ...validation.output] };
}

function openDestination(directory: string, source: string, scope: MemoryScope, io: MigrationIO): OpenDestination {
  const destination: MigrationDestination = io.destination(directory, source);
  const index: string | undefined = destination.exists() ? readCurrentIndex(destination.reader, directory) : undefined;
  return {
    destination,
    index,
    scope: index === undefined ? scope : readScope(index),
    skeleton: scopedSkeleton(io.skeleton, scope),
  };
}

function wikiPlan(target: OpenDestination, pages: ProjectPages, project: string): DestinationPlan {
  return { ...target, plan: planWiki(target.destination.reader, pages, project, target.skeleton) };
}

function personalDestination(path: string, from: string, main: OpenDestination, io: MigrationIO): OpenDestination {
  const personal: OpenDestination = openDestination(path, from, "personal", io);
  if (personal.destination.directory === main.destination.directory) {
    throw new Error(
      formatIssue(receivedIssue(path, "--personal-dest", path, "a directory distinct from the main destination")),
    );
  }
  if (personal.scope === "shared") {
    throw new Error(
      formatIssue(receivedIssue(path, "scope", personal.scope, "personal or project for --personal-dest")),
    );
  }
  return personal;
}

function routeWiki(
  source: ProjectPages,
  project: string,
  main: OpenDestination,
  personal?: OpenDestination,
): DestinationPlan[] {
  if (personal === undefined && main.scope !== "shared") return [wikiPlan(main, source, project)];
  const groups: Map<boolean, WikiPage[]> = Map.groupBy(
    source.pages,
    ({ type, kind }: WikiPage): boolean => type === "user" || kind === "profile",
  );
  const profiles: WikiPage[] = groups.get(true) ?? [];
  const rest: WikiPage[] = groups.get(false) ?? [];
  if (personal !== undefined) {
    return [
      wikiPlan(main, { ...source, pages: rest }, project),
      wikiPlan(personal, { pages: profiles, skips: [], issues: [] }, project),
    ];
  }
  const refused: Skipped[] = profiles.map(
    ({ path }: WikiPage): Skipped => ({
      target: path,
      reason: "personal page refused by shared scope; pass --personal-dest",
    }),
  );
  return [wikiPlan(main, { ...source, pages: rest, skips: [...source.skips, ...refused] }, project)];
}

function runWiki(options: WikiOptions, project: WikiProject, io: MigrationIO): MigrationResult {
  const main: OpenDestination = openDestination(options.dest, options.from, options.scope, io);
  const personal: OpenDestination | undefined =
    options.personalDest === undefined ? undefined : personalDestination(options.personalDest, options.from, main, io);
  const plans: DestinationPlan[] = routeWiki(readProject(io.source, project), project.name, main, personal);
  const results: MigrationResult[] = plans.map(
    (plan: DestinationPlan): MigrationResult => runPlan(plan, options.apply),
  );
  return {
    exitCode: results.some(({ exitCode }): boolean => exitCode === 1) ? 1 : 0,
    output: results.flatMap(({ output }): readonly string[] => output),
  };
}

function migrateWiki(options: Extract<MigrationOptions, { kind: "ai-memory" }>, io: MigrationIO): MigrationResult {
  const projects: WikiProject[] = findProjects(io.source, options.from);
  if (options.list) return listProjects(io.source, projects);
  const project: WikiProject = selectProject(projects, options.project);
  return runWiki(options, project, io);
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
    const target: OpenDestination = openDestination(options.dest, options.from, options.scope, io);
    const plan: MigrationPlan = planOptMem(target.destination.reader, readOptMemRecords(bytes), target.skeleton);
    return runPlan({ ...target, plan }, options.apply);
  } catch (error: unknown) {
    return { exitCode: 1, output: [errorText(error)] };
  }
}

if (import.meta.main) {
  const result: MigrationResult = runMigration(Bun.argv.slice(2), new DiskMigrationIO());
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
