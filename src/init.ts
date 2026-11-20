import { lstatSync, mkdirSync, readFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { formatIssue } from "./cli";
import type { FileChange } from "./file-changes";
import { fail, stageAndWrite, verifyChange, withWriteLock } from "./file-writes";
import {
  CURRENT_FORMAT,
  declaredScope,
  formatVersionIssue,
  insertScopeMarker,
  isMemoryScope,
  MEMORY_INDEX,
  type MemoryScope,
  readFormat,
  SCOPE_VALUES,
  scopeMarker,
  scopeMarkerIssue,
} from "./format";
import { type Issue, receivedIssue } from "./issue";
import { destinationPath, expandHome } from "./paths";
import { readSkeleton, type Skeleton, scopedSkeleton } from "./skeleton";

const LOG: string = "LOG.md";

interface InitDestination {
  index(): string | undefined;
  hasLog(): boolean;
  apply(changes: readonly FileChange[]): void;
}

export interface InitIO {
  readonly home: string;
  readonly skeleton: Skeleton;
  open(directory: string): InitDestination;
}

interface InitOptions {
  readonly directory: string;
  readonly scope: MemoryScope;
  readonly apply: boolean;
}

interface InitResult {
  readonly exitCode: 0 | 1;
  readonly output: readonly string[];
}

function parseOptions(args: readonly string[], home: string): InitOptions {
  const [directory, flag, scope, mode] = args;
  if (
    !directory ||
    directory.startsWith("-") ||
    args.length > 4 ||
    (mode !== undefined && mode !== "--apply") ||
    flag !== "--scope" ||
    !isMemoryScope(scope)
  ) {
    const usage: string = `hypermemory init <dir> --scope <${SCOPE_VALUES}> [--apply]`;
    throw new Error(formatIssue(receivedIssue("init", "arguments", args, usage)));
  }
  return { directory: expandHome(directory, home), scope, apply: mode === "--apply" };
}

function finishInit(
  { apply, scope }: InitOptions,
  target: InitDestination,
  changes: readonly FileChange[],
  action: string,
): InitResult {
  if (apply) target.apply(changes);
  return {
    exitCode: 0,
    output: [
      `${apply ? "Apply" : "Dry run"}: ${action}`,
      scopeMarker(scope),
      `format ${CURRENT_FORMAT}, scope ${scope}`,
    ],
  };
}

function createMemory(options: InitOptions, target: InitDestination, templates: Skeleton): InitResult {
  const skeleton: Skeleton = scopedSkeleton(templates, options.scope);
  const changes: FileChange[] = [];
  if (!target.hasLog()) changes.push({ file: LOG, before: undefined, content: skeleton.log });
  changes.push({ file: MEMORY_INDEX, before: undefined, content: skeleton.memory });
  const files: string = changes.map(({ file }): string => file).join(", ");
  return finishInit(options, target, changes, `create ${files} in ${options.directory}`);
}

function initialize(options: InitOptions, io: InitIO): InitResult {
  const { directory, scope }: InitOptions = options;
  const target: InitDestination = io.open(directory);
  const index: string | undefined = target.index();
  if (index === undefined) return createMemory(options, target, io.skeleton);
  const invalidScope: Issue | undefined = scopeMarkerIssue(index);
  if (invalidScope !== undefined) return { exitCode: 1, output: [formatIssue(invalidScope)] };
  const existingScope: MemoryScope | undefined = declaredScope(index);
  const format: bigint | undefined = readFormat(index);
  if (existingScope !== undefined)
    return { exitCode: 0, output: [`ok: format ${format ?? 0}, scope ${existingScope}`] };
  const issue: Issue | undefined = formatVersionIssue(format, directory);
  if (issue !== undefined) return { exitCode: 1, output: [formatIssue(issue)] };
  const change: FileChange = { file: MEMORY_INDEX, before: index, content: insertScopeMarker(index, scope) };
  return finishInit(options, target, [change], `insert line 2 in ${join(directory, MEMORY_INDEX)}`);
}

export function runInit(args: readonly string[], io: InitIO): InitResult {
  try {
    return initialize(parseOptions(args, io.home), io);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, output: [message] };
  }
}

class DiskInitDestination implements InitDestination {
  constructor(private readonly directory: string) {}

  index(): string | undefined {
    const file: string = join(this.directory, MEMORY_INDEX);
    const stat: Stats | undefined = lstatSync(file, { throwIfNoEntry: false });
    if (stat === undefined) return undefined;
    if (!stat.isFile()) fail(file, "index", file, "a regular index file");
    return readFileSync(file, "utf8");
  }

  hasLog(): boolean {
    return lstatSync(join(this.directory, LOG), { throwIfNoEntry: false }) !== undefined;
  }

  apply(changes: readonly FileChange[]): void {
    mkdirSync(dirname(this.directory), { recursive: true });
    withWriteLock(this.directory, (): void => {
      for (const change of changes) verifyChange(join(this.directory, change.file), change);
      mkdirSync(this.directory, { recursive: true });
      for (const change of changes) {
        const path: string = join(this.directory, change.file);
        stageAndWrite(path, change, verifyChange(path, change));
      }
    });
  }
}

export class DiskInitIO implements InitIO {
  readonly home: string = homedir();

  get skeleton(): Skeleton {
    return readSkeleton();
  }

  open(directory: string): InitDestination {
    return new DiskInitDestination(destinationPath(directory));
  }
}

if (import.meta.main) {
  const result: InitResult = runInit(Bun.argv.slice(2), new DiskInitIO());
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
