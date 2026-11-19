import { formatIssue } from "../cli";
import { changedFiles, type FileChange } from "../file-changes";
import { CURRENT_FORMAT, MEMORY_INDEX, newerFormatIssue, readFormat } from "../format";
import { type Issue, receivedIssue } from "../issue";
import { FORMAT_MIGRATIONS, type RegisteredMigration } from "./migrations";

interface UpgradeStep {
  readonly id: string;
  readonly description: string;
  readonly changes: readonly FileChange[];
}

export interface UpgradePlan {
  readonly from: number;
  readonly files: ReadonlyMap<string, string>;
  readonly steps: readonly UpgradeStep[];
  readonly changes: readonly FileChange[];
}

function stepFrom(registry: readonly RegisteredMigration[], from: number): RegisteredMigration {
  const entry: RegisteredMigration | undefined = registry[from];
  if (entry?.migration.from !== from || entry.migration.to !== from + 1) {
    const expected: string = `a migration from format ${from} to ${from + 1}`;
    throw new Error(formatIssue(receivedIssue("migration registry", "step", entry?.id, expected)));
  }
  return entry;
}

function assertValidOutput(
  entry: RegisteredMigration,
  input: ReadonlyMap<string, string>,
  output: ReadonlyMap<string, string>,
): void {
  for (const file of input.keys()) {
    if (!output.has(file)) {
      const issue: Issue = receivedIssue(entry.id, "omitted file", file, "every input file to be retained");
      throw new Error(formatIssue(issue));
    }
  }
  const version: bigint | undefined = readFormat(output.get(MEMORY_INDEX) ?? "");
  if (version !== BigInt(entry.migration.to)) {
    throw new Error(
      `${entry.id}: ${MEMORY_INDEX}:1: format: received ${version ?? "missing"}, expected hypermemory-format ${entry.migration.to}`,
    );
  }
}

function assertFlatPaths(id: string, changes: readonly FileChange[]): void {
  for (const { file } of changes) {
    if (file === "" || file === "." || file === ".." || /[/\\\0]/.test(file)) {
      const issue: Issue = receivedIssue(id, "output path", file, "a plain filename in the memory directory");
      throw new Error(formatIssue(issue));
    }
  }
}

function sortedChanges(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): FileChange[] {
  return changedFiles(before, after).sort(
    (a: FileChange, b: FileChange): number => Number(a.file > b.file) - Number(a.file < b.file),
  );
}

export function planUpgrade(
  input: ReadonlyMap<string, string>,
  registry: readonly RegisteredMigration[] = FORMAT_MIGRATIONS,
): UpgradePlan {
  const version: bigint = readFormat(input.get(MEMORY_INDEX) ?? "") ?? 0n;
  if (version > CURRENT_FORMAT) throw new Error(formatIssue(newerFormatIssue(version)));
  const from: number = Number(version);
  const steps: UpgradeStep[] = [];
  let files: ReadonlyMap<string, string> = input;
  for (let format: number = from; format < CURRENT_FORMAT; format++) {
    const entry: RegisteredMigration = stepFrom(registry, format);
    const next: ReadonlyMap<string, string> = entry.migration.apply(new Map(files));
    assertValidOutput(entry, files, next);
    const changes: FileChange[] = sortedChanges(files, next);
    assertFlatPaths(entry.id, changes);
    steps.push({ id: entry.id, description: entry.migration.description, changes });
    files = next;
  }
  return { from, files, steps, changes: files === input ? [] : sortedChanges(input, files) };
}

function describeChange({ file, before, content }: FileChange): string {
  const name: string = file.replaceAll(/[\r\n]/g, " ");
  const size: number = Buffer.byteLength(content);
  const detail: string =
    before === undefined ? `create (${size} bytes)` : `update (${Buffer.byteLength(before)} → ${size} bytes)`;
  return `  ${name}: ${detail}`;
}

export function describeUpgrade(plan: UpgradePlan, apply: boolean): string[] {
  const output: string[] = [`${apply ? "Apply" : "Dry run"}: format ${plan.from} → ${CURRENT_FORMAT}`];
  for (const { id, description, changes } of plan.steps) {
    output.push(`${id}: ${description}`, ...changes.map(describeChange));
  }
  return output;
}
