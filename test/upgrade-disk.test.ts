import { afterEach, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runUpgrade } from "../src/upgrade";
import { DiskUpgradeIO } from "../src/upgrade/disk";
import { markedIndex, memory } from "./fixtures";

const temporary: string[] = [];
const LEGACY: string = "- [Fact](fact.md)\r\n";

afterEach((): void => {
  for (const parent of temporary.splice(0)) rmSync(parent, { recursive: true, force: true });
});

function fixture(name: string): string {
  const directory: string = mkdtempSync(join(tmpdir(), `hypermemory-${name}-`));
  temporary.push(directory);
  return directory;
}

function legacyDirectory(parent: string): string {
  const directory: string = join(parent, "memory");
  mkdirSync(directory);
  writeFileSync(join(directory, "MEMORY.md"), LEGACY);
  writeFileSync(join(directory, "fact.md"), memory("fact"));
  return directory;
}

function fixedDisk(): DiskUpgradeIO {
  return new DiskUpgradeIO((): Date => new Date("2026-11-19T00:01:02Z"));
}

test("real upgrade of a linked directory backs up the entire target beside it and preserves every unchanged entry", (): void => {
  const target: string = legacyDirectory(fixture("target"));
  const aliases: string = fixture("aliases");
  const alias: string = join(aliases, "linked");
  symlinkSync(target, alias);
  mkdirSync(join(target, "nested"));
  writeFileSync(join(target, "nested", "raw"), Uint8Array.from([0xff, 0x00]));
  writeFileSync(join(target, ".hidden"), "unchanged");
  symlinkSync("fact.md", join(target, "saved-link"));
  const result: ReturnType<typeof runUpgrade> = runUpgrade([alias, "--apply"], fixedDisk());
  const backup: string = `${target}.backup-format-0-20261119T000102`;
  expect(result.output).toContain(`Backup: ${backup}`);
  expect(result.exitCode).toBe(0);
  expect(readFileSync(join(target, "MEMORY.md"), "utf8")).toBe(markedIndex(LEGACY, "\r\n"));
  expect(readFileSync(join(backup, "MEMORY.md"), "utf8")).toBe(LEGACY);
  expect(readFileSync(join(backup, "fact.md"), "utf8")).toBe(memory("fact"));
  expect(readFileSync(join(backup, ".hidden"), "utf8")).toBe("unchanged");
  expect([...readFileSync(join(backup, "nested", "raw"))]).toEqual([0xff, 0x00]);
  expect(readlinkSync(join(backup, "saved-link"))).toBe("fact.md");
  expect(readdirSync(aliases)).toEqual(["linked"]);
  expect(lstatSync(alias).isSymbolicLink()).toBe(true);
});

test("apply refuses a colliding backup whether the existing path is a directory or a file", (): void => {
  for (const kind of ["dir", "file"]) {
    const target: string = legacyDirectory(fixture(kind));
    const backup: string = `${target}.backup-format-0-20261119T000102`;
    if (kind === "dir") mkdirSync(backup);
    else writeFileSync(backup, "sentinel");
    const result: ReturnType<typeof runUpgrade> = runUpgrade([target, "--apply"], fixedDisk());
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toContain(backup);
    expect(readFileSync(join(target, "MEMORY.md"), "utf8")).toBe(LEGACY);
    if (kind === "dir") expect(readdirSync(backup)).toEqual([]);
    else expect(readFileSync(backup, "utf8")).toBe("sentinel");
  }
});

test("apply refuses symlinked index files and a held directory lock", (): void => {
  const parent: string = fixture("protected");
  const target: string = join(parent, "memory");
  const outside: string = join(parent, "original.md");
  mkdirSync(target);
  writeFileSync(outside, LEGACY);
  symlinkSync(outside, join(target, "MEMORY.md"));
  const lock: string = `${target}.hypermemory-write.lock`;
  mkdirSync(lock);
  const blocked: ReturnType<typeof runUpgrade> = runUpgrade([target, "--apply"], fixedDisk());
  expect(blocked.exitCode).toBe(1);
  expect(blocked.output.join()).toContain("expected an unlocked destination");
  rmSync(lock, { recursive: true });
  const linked: ReturnType<typeof runUpgrade> = runUpgrade([target, "--apply"], fixedDisk());
  expect(linked.exitCode).toBe(1);
  expect(linked.output.join()).toContain("expected a regular unshared file");
  expect(readFileSync(outside, "utf8")).toBe(LEGACY);
});

test("package script and direct entry point upgrade real directories from dry-run through repeat apply", (): void => {
  for (const entry of ["upgrade", "src/upgrade.ts"]) {
    const parent: string = fixture("package");
    const target: string = legacyDirectory(parent);
    for (const [flags, expected] of [
      [[], "Dry run: format 0 → 1"],
      [["--apply"], "ok: 1 memory files, MEMORY.md 2 lines, scope project"],
      [["--apply"], "ok: already at format 1"],
    ] as const) {
      const result: Bun.ReadableSyncSubprocess = Bun.spawnSync([process.execPath, "run", entry, target, ...flags]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(expected);
      expect(readdirSync(parent)).toHaveLength(flags.length === 0 ? 1 : 2);
    }
  }
});

test("the in-repo wrapper dispatches through a symlink from a different working directory", (): void => {
  const parent: string = fixture("wrapper");
  const target: string = legacyDirectory(parent);
  const wrapper: string = join(parent, "hypermemory");
  symlinkSync(resolve("bin/hypermemory"), wrapper);
  const source: string = join(parent, "opt");
  mkdirSync(source);
  for (const [args, status, expected] of [
    [["check", target], 1, "format: received missing"],
    [["upgrade", target], 0, "Dry run: format 0 → 1"],
    [["migrate", "optmem", "--from", source, join(parent, "new")], 0, "Dry run"],
    [["unknown"], 1, "check | migrate | upgrade | init"],
  ] as const) {
    const result: Bun.ReadableSyncSubprocess = Bun.spawnSync([wrapper, ...args], { cwd: parent });
    expect(result.exitCode).toBe(status);
    expect(result.stdout.toString() + result.stderr.toString()).toContain(expected);
  }
});
