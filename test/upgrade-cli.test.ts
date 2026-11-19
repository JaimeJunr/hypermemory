import { expect, test } from "bun:test";
import type { FileChange } from "../src/migration/plan";
import { runUpgrade, type UpgradeDestination, type UpgradeIO } from "../src/upgrade";
import { FakeMemoryReader, FakePreviousLogReader, markedIndex, memory } from "./fixtures";

class FakeUpgradeDestination implements UpgradeDestination {
  readonly directory: string = "/resolved/memory";
  readonly reader: FakeMemoryReader;
  readonly previousLog: FakePreviousLogReader = new FakePreviousLogReader();
  readonly operations: string[] = [];

  constructor(
    readonly files: Record<string, string> = {},
    private readonly failAt?: "backup" | "write",
  ) {
    this.reader = new FakeMemoryReader(files);
  }

  withWriteLock<T>(work: () => T): T {
    this.operations.push("lock");
    return work();
  }

  backup(path: string): void {
    this.operations.push(`backup ${path}`);
    if (this.failAt === "backup") throw new Error("EEXIST");
  }

  write(changes: readonly FileChange[]): void {
    this.operations.push("write");
    if (this.failAt === "write") throw new Error("EACCES");
    for (const { file, content } of changes) this.files[file] = content;
  }
}

class FakeUpgradeIO implements UpgradeIO {
  readonly opened: string[] = [];

  constructor(readonly target: FakeUpgradeDestination = new FakeUpgradeDestination()) {}

  open(directory: string): UpgradeDestination {
    this.opened.push(directory);
    return this.target;
  }

  now(): Date {
    return new Date("2026-11-19T12:34:56.789Z");
  }
}

test("CLI rejects absent, empty, extra or unsupported arguments without opening a directory", (): void => {
  const io: FakeUpgradeIO = new FakeUpgradeIO();
  for (const args of [[], [""], ["--apply"], ["memory", "--force"], ["memory", "--apply", "extra"]]) {
    const result: ReturnType<typeof runUpgrade> = runUpgrade(args, io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toMatch(/received .*expected bun run src\/upgrade\.ts/);
  }
  expect(io.opened).toEqual([]);
});

test("dry-run describes each step and changed file for an absent or existing index without writing", (): void => {
  for (const [files, summary] of [
    [{}, "  MEMORY.md: create (31 bytes)"],
    [{ "MEMORY.md": "# Index\n" }, "  MEMORY.md: update (8 → 39 bytes)"],
  ] as const) {
    const target: FakeUpgradeDestination = new FakeUpgradeDestination({ ...files });
    const result: ReturnType<typeof runUpgrade> = runUpgrade(["memory"], new FakeUpgradeIO(target));
    expect(result).toEqual({
      exitCode: 0,
      output: ["Dry run: format 0 → 1", "0001-add-format-marker: Add the format-1 marker to MEMORY.md", summary],
    });
    expect(target.operations).toEqual([]);
    expect(target.files).toEqual(files);
  }
});

test("apply backs up the resolved target before writing, validates it, and does nothing on repeat", (): void => {
  const fixtures: readonly Readonly<Record<string, string>>[] = [
    {},
    { "MEMORY.md": "- [Fact](one.md)\n", "one.md": memory("one") },
  ];
  for (const files of fixtures) {
    const io: FakeUpgradeIO = new FakeUpgradeIO(new FakeUpgradeDestination({ ...files }));
    const args: string[] = ["link", "--apply"];
    const applied: ReturnType<typeof runUpgrade> = runUpgrade(args, io);
    expect(applied.exitCode).toBe(0);
    expect(applied.output.at(-1)).toStartWith("ok:");
    expect(io.target.operations).toEqual(["lock", "backup /resolved/memory.backup-format-0-20261119T123456", "write"]);
    expect(runUpgrade(args, io)).toEqual({ exitCode: 0, output: ["ok: already at format 1"] });
    expect(io.target.operations).toHaveLength(3);
  }
});

test("apply leaves writes untouched on backup failure and reports the backup after a later failure", (): void => {
  for (const failure of ["backup", "write"] as const) {
    const target: FakeUpgradeDestination = new FakeUpgradeDestination({}, failure);
    const result: ReturnType<typeof runUpgrade> = runUpgrade(["memory", "--apply"], new FakeUpgradeIO(target));
    expect(result.exitCode).toBe(1);
    expect(target.files).toEqual({});
    expect(target.operations.includes("write")).toBe(failure === "write");
    expect(result.output.join("\n")).toContain(failure === "backup" ? "EEXIST" : "Backup: /resolved/memory.backup");
  }
});

class FakeChangingDestination extends FakeUpgradeDestination {
  constructor(private readonly changeAt: "lock" | "backup") {
    super();
  }

  override withWriteLock<T>(work: () => T): T {
    if (this.changeAt === "lock") this.files["changed.txt"] = "external change";
    return super.withWriteLock(work);
  }

  override backup(path: string): void {
    super.backup(path);
    if (this.changeAt === "backup") this.files["changed.txt"] = "external change";
  }
}

test("apply refuses to write against an altered plan before or after backing up", (): void => {
  for (const stage of ["lock", "backup"] as const) {
    const target: FakeChangingDestination = new FakeChangingDestination(stage);
    const result: ReturnType<typeof runUpgrade> = runUpgrade(["memory", "--apply"], new FakeUpgradeIO(target));
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toContain("expected the same contents as during planning");
    expect(target.operations.some((operation: string): boolean => operation.startsWith("backup "))).toBe(
      stage === "backup",
    );
    expect(target.files).toEqual({ "changed.txt": "external change" });
  }
});

test("apply validates the written directory and exits one for two kinds of issues", (): void => {
  for (const [files, issue] of [
    [{ "MEMORY.md": "- [Missing](missing.md)" }, "link target: received"],
    [{ "LOG.md": "invalid" }, "line format: received"],
  ] as const) {
    const io: FakeUpgradeIO = new FakeUpgradeIO(new FakeUpgradeDestination({ ...files }));
    const result: ReturnType<typeof runUpgrade> = runUpgrade(["memory", "--apply"], io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toContain(issue);
    expect(io.target.files["MEMORY.md"]).toStartWith(markedIndex());
  }
});

test("newer formats are refused in both dry-run and apply mode without writes", (): void => {
  const io: FakeUpgradeIO = new FakeUpgradeIO(
    new FakeUpgradeDestination({ "MEMORY.md": "<!-- hypermemory-format: 2 -->" }),
  );
  for (const flags of [[], ["--apply"]]) {
    expect(runUpgrade(["memory", ...flags], io)).toEqual({
      exitCode: 1,
      output: ["MEMORY.md:1: format: received 2, expected at most 1; update Hypermemory"],
    });
  }
  expect(io.target.operations).toEqual([]);
});
