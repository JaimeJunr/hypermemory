import { formatIssue, type MemorySources, runCli } from "./cli";
import type { FileChange } from "./file-changes";
import { CURRENT_FORMAT, MEMORY_INDEX, newerFormatIssue, readFormat } from "./format";
import { OVERFLOW_HINT, overflowIssues } from "./indexes";
import { type Issue, receivedIssue } from "./issue";
import { DiskUpgradeIO } from "./upgrade/disk";
import { describeUpgrade, planUpgrade, type UpgradePlan } from "./upgrade/plan";
import type { MemoryReader } from "./validator";

export interface UpgradeDestination extends MemorySources {
  readonly directory: string;
  withWriteLock<T>(work: () => T): T;
  backup(path: string): void;
  write(changes: readonly FileChange[]): void;
}

export interface UpgradeIO {
  open(directory: string): UpgradeDestination;
  now(): Date;
}

interface UpgradeResult {
  readonly exitCode: 0 | 1;
  readonly output: readonly string[];
}

function snapshot(reader: MemoryReader, names: readonly string[]): ReadonlyMap<string, string> {
  const files: Map<string, string> = new Map();
  for (const name of [...names].sort()) files.set(name, reader.read(name));
  return files;
}

function verifySnapshot(reader: MemoryReader, files: ReadonlyMap<string, string>): void {
  const names: readonly string[] = reader.list();
  const matches: boolean =
    names.length === files.size && names.every((name: string): boolean => reader.read(name) === files.get(name));
  if (!matches)
    throw new Error("directory state: received changed files, expected the same contents as during planning");
}

function backupName(directory: string, from: number, now: Date): string {
  const time: string = now.toISOString().slice(0, 19).replaceAll(/[-:]/g, "");
  return `${directory}.backup-format-${from}-${time}`;
}

function applyUpgrade(
  target: UpgradeDestination,
  input: ReadonlyMap<string, string>,
  plan: UpgradePlan,
  io: UpgradeIO,
  output: string[],
): UpgradeResult {
  return target.withWriteLock((): UpgradeResult => {
    verifySnapshot(target.reader, input);
    const backup: string = backupName(target.directory, plan.from, io.now());
    target.backup(backup);
    output.push(`Backup: ${backup}`);
    verifySnapshot(target.reader, input);
    target.write(plan.changes);
    const validation: ReturnType<typeof runCli> = runCli([target.directory], (): MemorySources => target);
    return { exitCode: validation.exitCode, output: [...output, ...validation.output] };
  });
}

function upgrade(directory: string, apply: boolean, io: UpgradeIO, output: string[]): UpgradeResult {
  const target: UpgradeDestination = io.open(directory);
  const names: readonly string[] = target.reader.list();
  const version: bigint | undefined = names.includes(MEMORY_INDEX)
    ? readFormat(target.reader.read(MEMORY_INDEX))
    : undefined;
  if (version === BigInt(CURRENT_FORMAT)) return { exitCode: 0, output: [`ok: already at format ${CURRENT_FORMAT}`] };
  if (version !== undefined && version > CURRENT_FORMAT) {
    return { exitCode: 1, output: [formatIssue(newerFormatIssue(version))] };
  }
  const input: ReadonlyMap<string, string> = snapshot(target.reader, names);
  const plan: UpgradePlan = planUpgrade(input);
  if (plan.steps.length === 0) return { exitCode: 0, output: [`ok: already at format ${CURRENT_FORMAT}`] };
  const overflow: string[] = overflowIssues(plan.files.get(MEMORY_INDEX) ?? "").map(
    (issue: Issue): string => `${formatIssue(issue)}; ${OVERFLOW_HINT} and run the upgrade again`,
  );
  if (overflow.length > 0) return { exitCode: 1, output: overflow };
  output.push(...describeUpgrade(plan, apply));
  if (!apply) return { exitCode: 0, output };
  return applyUpgrade(target, input, plan, io, output);
}

export function runUpgrade(args: readonly string[], io: UpgradeIO): UpgradeResult {
  const [directory, flag] = args;
  if (!directory || directory.startsWith("-") || args.length > 2 || (flag !== undefined && flag !== "--apply")) {
    const usage: string = "bun run src/upgrade.ts <memory-dir> [--apply]";
    return { exitCode: 1, output: [formatIssue(receivedIssue("upgrade", "arguments", args, usage))] };
  }
  const output: string[] = [];
  try {
    return upgrade(directory, flag === "--apply", io, output);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    const issue: Issue = receivedIssue(directory, "upgrade", message, "an upgradeable memory directory");
    return { exitCode: 1, output: [...output, formatIssue(issue)] };
  }
}

if (import.meta.main) {
  const result: UpgradeResult = runUpgrade(Bun.argv.slice(2), new DiskUpgradeIO());
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
