import { expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runMigration } from "../src/migrate";
import { DiskMigrationIO } from "../src/migration/disk";
import { optRecord, projectFiles } from "./migrate-fixtures";

interface TemporaryDir extends Disposable {
  readonly path: string;
}

// mkdtempDisposableSync só existe no Bun 1.4+; este helper roda também no 1.3.
function mkdtempDisposableSync(prefix: string): TemporaryDir {
  const path: string = mkdtempSync(prefix);
  return { path, [Symbol.dispose]: (): void => rmSync(path, { recursive: true, force: true }) };
}

interface Invocation {
  readonly exitCode: number;
  readonly output: string;
}

function invokeCli(args: readonly string[]): Invocation {
  const result: Bun.ReadableSyncSubprocess = Bun.spawnSync([process.execPath, "run", "src/migrate.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

function invoke(args: readonly string[]): Invocation {
  const result = runMigration(args, new DiskMigrationIO());
  return { exitCode: result.exitCode, output: result.output.join("\n") };
}

function optSource(parent: string): string {
  const source: string = join(parent, "opt");
  mkdirSync(source);
  writeFileSync(join(source, "LOG.txt"), optRecord("#0 2026-11-19 Unique note"));
  return source;
}

test("disk migration dry run leaves a nested destination absent, and apply writes the exact skeleton", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const parent: string = temporary.path;
  const source: string = optSource(parent);
  const dest: string = join(parent, "nested", "dest");
  const args: string[] = ["optmem", "--from", source, dest];
  expect(invokeCli(args).output).toContain("Dry run");
  expect(existsSync(join(parent, "nested"))).toBe(false);
  const applied: Invocation = invoke([...args, "--apply"]);
  expect(applied.exitCode).toBe(0);
  expect(applied.output).toContain("ok: 0 memory files, MEMORY.md 1 lines");
  expect(readFileSync(join(dest, "MEMORY.md"), "utf8")).toBe(readFileSync("memory/MEMORY.md", "utf8"));
  expect(readFileSync(join(dest, "LOG.md"), "utf8")).toBe(
    `${readFileSync("memory/LOG.md", "utf8")}2026-11-19 | event | Unique note\n`,
  );
  expect(readdirSync(dest).sort()).toEqual(["LOG.md", "MEMORY.md"]);
  expect(invoke([...args, "--apply"]).output).toContain("0 files to create, 0 files to update");
  expect(readFileSync(join(source, "LOG.txt")).equals(optRecord("#0 2026-11-19 Unique note"))).toBe(true);
});

test("disk migration appends to the existing log without replacing its inode", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const source = optSource(temporary.path);
  const dest = join(temporary.path, "dest");
  const log = join(dest, "LOG.md");
  mkdirSync(dest);
  const before = "2026-11-18 | event | Previous note\n";
  writeFileSync(log, before);
  const inode = statSync(log).ino;
  expect(invoke(["optmem", "--from", source, dest, "--apply"]).exitCode).toBe(0);
  expect(readFileSync(log, "utf8")).toBe(`${before}2026-11-19 | event | Unique note\n`);
  expect(statSync(log).ino).toBe(inode);
});

test("disk migration rejects direct and aliased destinations under the source before creating files", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const parent: string = temporary.path;
  const source: string = optSource(parent);
  const alias: string = join(parent, "alias");
  symlinkSync(source, alias, "dir");
  for (const dest of [source, join(source, "new"), join(alias, "nested", "new")]) {
    const result: Invocation = invoke(["optmem", "--from", source, dest, "--apply"]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("expected a destination outside the source directory");
  }
  expect(readdirSync(source)).toEqual(["LOG.txt"]);
});

test("disk migration refuses to append through symlinked and hard-linked logs", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const parent: string = temporary.path;
  const source: string = optSource(parent);
  const original: string = join(source, "historical.md");
  writeFileSync(original, "2026-11-19 | event | Original\n");
  for (const [kind, attach] of [
    ["symbolic", symlinkSync],
    ["hard", linkSync],
  ] as const) {
    const dest: string = join(parent, kind);
    mkdirSync(dest);
    attach(original, join(dest, "LOG.md"));
    const result: Invocation = invoke(["optmem", "--from", source, dest, "--apply"]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/received .*expected .*regular .*file/);
    expect(readdirSync(dest)).toEqual(["LOG.md"]);
  }
  expect(readFileSync(original, "utf8")).toBe("2026-11-19 | event | Original\n");
});

test("the package script invokes the CLI in dry-run and apply modes", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const parent: string = temporary.path;
  const source: string = optSource(parent);
  const args: string[] = ["optmem", "--from", source, join(parent, "dest")];
  for (const [flags, expected] of [
    [[], "Dry run"],
    [["--apply"], "ok: 0 memory files, MEMORY.md 1 lines"],
  ] as const) {
    const result: Bun.ReadableSyncSubprocess = Bun.spawnSync([process.execPath, "run", "migrate", ...args, ...flags]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(expected);
  }
});

function writeFixtures(files: Readonly<Record<string, string>>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
}

test("disk migration refuses to replace a hard-linked MEMORY.md and leaves other planned files absent", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const wiki: string = join(temporary.path, "wiki");
  const project: string = join(wiki, "workspace/project");
  const source: string = join(project, "index.md");
  const dest: string = join(temporary.path, "dest");
  writeFixtures(projectFiles(project, "Example", { "index.md": "# Original\n", "notes/one.md": "# One" }));
  mkdirSync(dest);
  linkSync(source, join(dest, "MEMORY.md"));
  const result: Invocation = invoke(["ai-memory", "--from", wiki, "--project", "Example", dest, "--apply"]);
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/received .*expected .*regular .*file/);
  expect(readdirSync(dest)).toEqual(["MEMORY.md"]);
  expect(readFileSync(source, "utf8")).toBe("# Original\n");
});

test("disk migration errors identify files received in place of source and destination directories", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const source: string = optSource(temporary.path);
  const file: string = join(source, "LOG.txt");
  const missing: string = join(temporary.path, "dest");
  for (const [from, dest, expected] of [
    [file, missing, "an OptMem directory"],
    [source, file, "a destination directory"],
  ] as const) {
    const result: Invocation = invoke(["optmem", "--from", from, dest]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`received ${JSON.stringify(file)}, expected ${expected}`);
  }
});

test("real ai-memory applies overflow indexes and leaves all 151 pages and indexes unchanged on repeat", (): void => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), "hypermemory-disk-test-"));
  const wiki: string = join(temporary.path, "wiki");
  const project: string = join(wiki, "workspace/project");
  const dest: string = join(temporary.path, "dest");
  const pages: Record<string, string> = { "references/ref.md": "# Reference" };
  for (let index: number = 0; index < 150; index++) pages[`notes/page-${index}.md`] = "# Note";
  writeFixtures(projectFiles(project, "Example", pages));
  const args: string[] = ["ai-memory", "--from", wiki, "--project", "Example", dest, "--apply"];
  const first: Invocation = invoke(args);
  expect(first.exitCode).toBe(0);
  expect(first.output).toContain("ok: 151 memory files, MEMORY.md 3 lines");
  expect(readFileSync(join(dest, "MEMORY.md"), "utf8")).toContain("150 memórias de concept migradas do ai-memory");
  expect(readFileSync(join(dest, "index-concept.md"), "utf8").split("\n")).toHaveLength(152);
  expect(readdirSync(dest)).toHaveLength(155);
  const again: Invocation = invoke(args);
  expect(again.exitCode).toBe(0);
  expect(again.output).toContain("0 files to create, 0 files to update");
});
