import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileChange } from "../src/file-changes";
import { DiskInitIO, type InitIO, runInit } from "../src/init";
import type { Skeleton } from "../src/skeleton";
import { markedIndex } from "./fixtures";

interface Invocation {
  readonly exitCode: number;
  readonly output: string;
}

const temporary: string[] = [];

afterEach((): void => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(): string {
  const parent: string = mkdtempSync(join(tmpdir(), "hypermemory-init-"));
  temporary.push(parent);
  return join(parent, "nested", "memory");
}

function init(directory: string, ...flags: string[]): Invocation {
  const result: ReturnType<typeof runInit> = runInit([directory, ...flags], new DiskInitIO());
  return { exitCode: result.exitCode, output: `${result.output.join("\n")}\n` };
}

function invokeWrapper(directory: string, ...flags: string[]): Invocation {
  const result: Bun.ReadableSyncSubprocess = Bun.spawnSync(["bin/hypermemory", "init", directory, ...flags]);
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
}

test("init previews and creates exact scoped skeletons for shared and personal", (): void => {
  for (const scope of ["shared", "personal"]) {
    const directory: string = fixture();
    const skeleton: string = readFileSync("memory/MEMORY.md", "utf8").split("\n").slice(1).join("\n");
    const dry: Invocation = invokeWrapper(directory, "--scope", scope);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("Dry run");
    expect(dry.output).toContain(`<!-- hypermemory-scope: ${scope} -->`);
    expect(existsSync(directory)).toBe(false);
    expect(init(directory, "--scope", scope, "--apply").exitCode).toBe(0);
    expect(readdirSync(directory).sort()).toEqual(["LOG.md", "MEMORY.md"]);
    expect(readFileSync(join(directory, "MEMORY.md"), "utf8")).toBe(
      markedIndex(`<!-- hypermemory-scope: ${scope} -->\n${skeleton}`),
    );
    expect(readFileSync(join(directory, "LOG.md"), "utf8")).toBe(readFileSync("memory/LOG.md", "utf8"));
  }
});

test("init inserts only line two, preserving LF and CRLF, then reports the existing format and scope", (): void => {
  for (const newline of ["\n", "\r\n"]) {
    const directory: string = fixture();
    mkdirSync(directory, { recursive: true });
    const index: string = join(directory, "MEMORY.md");
    const original: string = markedIndex(`# Index${newline}Last line`, newline);
    writeFileSync(index, original);
    writeFileSync(join(directory, "page.md"), "original");
    const dry: Invocation = init(directory, "--scope", "shared");
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("line 2");
    expect(readFileSync(index, "utf8")).toBe(original);
    expect(init(directory, "--scope", "shared", "--apply").exitCode).toBe(0);
    const updated: string = markedIndex(
      `<!-- hypermemory-scope: shared -->${newline}# Index${newline}Last line`,
      newline,
    );
    expect(readFileSync(index, "utf8")).toBe(updated);
    expect(init(directory, "--scope", "personal", "--apply")).toEqual({
      exitCode: 0,
      output: "ok: format 1, scope shared\n",
    });
    expect(readFileSync(index, "utf8")).toBe(updated);
    expect(readFileSync(join(directory, "page.md"), "utf8")).toBe("original");
    expect(readdirSync(directory).sort()).toEqual(["MEMORY.md", "page.md"]);
  }
});

test("init preserves an existing log and rejects invalid scope arguments", (): void => {
  const directory: string = fixture();
  mkdirSync(directory, { recursive: true });
  const log: string = join(directory, "LOG.md");
  writeFileSync(log, "existing log");
  for (const flags of [[], ["--scope"], ["--scope", "public"], ["--scope", "shared", "--apply", "--apply"]]) {
    const result: Invocation = init(directory, ...flags);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("received");
    expect(result.output).toContain("personal|project|shared");
    expect(readdirSync(directory)).toEqual(["LOG.md"]);
  }
  expect(init(directory, "--scope", "project", "--apply").exitCode).toBe(0);
  expect(readFileSync(log, "utf8")).toBe("existing log");
});

test("init reports existing scoped formats and refuses to insert into a legacy or future index", (): void => {
  const directory: string = fixture();
  mkdirSync(directory, { recursive: true });
  const index: string = join(directory, "MEMORY.md");
  for (const [content, expected] of [
    ["# Legacy\n", "run hypermemory upgrade"],
    ["<!-- hypermemory-format: 2 -->\n", "expected at most 1"],
  ] as const) {
    writeFileSync(index, content);
    const result: Invocation = init(directory, "--scope", "project", "--apply");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(expected);
    expect(readFileSync(index, "utf8")).toBe(content);
  }
  const future: string = "<!-- hypermemory-format: 2 -->\n<!-- hypermemory-scope: personal -->\n";
  writeFileSync(index, future);
  expect(init(directory, "--scope", "project", "--apply")).toEqual({
    exitCode: 0,
    output: "ok: format 2, scope personal\n",
  });
  expect(readFileSync(index, "utf8")).toBe(future);
});

class FakeInitDestination implements ReturnType<InitIO["open"]> {
  readonly writes: FileChange[][] = [];

  constructor(
    private readonly content: string,
    private readonly writeError?: string,
  ) {}

  index(): string {
    return this.content;
  }

  hasLog(): boolean {
    throw new Error("Expected init to leave the log alone");
  }

  apply(changes: readonly FileChange[]): void {
    if (this.writeError !== undefined) throw new Error(this.writeError);
    this.writes.push([...changes]);
  }
}

class FakeInitIO implements InitIO {
  readonly home: string = "/home/test";
  readonly opened: string[] = [];
  readonly skeleton: Skeleton = { memory: markedIndex(), log: "" };

  constructor(readonly destination: FakeInitDestination) {}

  open(directory: string): FakeInitDestination {
    this.opened.push(directory);
    return this.destination;
  }
}

test("init expands a home-relative destination and rejects invalid scope markers without writing", (): void => {
  for (const marker of ["<!-- hypermemory-scope: invalid -->", "<!-- hypermemory-scope: shared"]) {
    const io: FakeInitIO = new FakeInitIO(new FakeInitDestination(markedIndex(marker)));
    const result: ReturnType<typeof runInit> = runInit(["~/.claude/hypermemory", "--scope", "personal", "--apply"], io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toMatch(/MEMORY.md:2: scope: received .*expected one of personal\|project\|shared/);
    expect(io.opened).toEqual(["/home/test/.claude/hypermemory"]);
    expect(io.destination.writes).toEqual([]);
  }
});

test("init applies one index write and surfaces a blocked write from its destination", (): void => {
  for (const error of [undefined, 'write lock: received "present", expected an unlocked destination']) {
    const index: string = markedIndex();
    const io: FakeInitIO = new FakeInitIO(new FakeInitDestination(index, error));
    const result: ReturnType<typeof runInit> = runInit(["/memory", "--scope", "shared", "--apply"], io);
    expect(result.exitCode).toBe(error === undefined ? 0 : 1);
    if (error !== undefined) expect(result.output).toEqual([error]);
    const changes: FileChange[][] = [
      [
        {
          file: "MEMORY.md",
          before: index,
          content: markedIndex("<!-- hypermemory-scope: shared -->\n"),
        },
      ],
    ];
    expect(io.destination.writes).toEqual(error === undefined ? changes : []);
  }
});

test("init refuses to insert the scope marker when the index would exceed its line or byte budget", (): void => {
  const fullLines: string = markedIndex(
    Array.from({ length: 149 }, (_, i: number): string => `- [F${i}](f${i}.md)`).join("\n"),
  );
  const fullBytes: string = markedIndex(`- [Big](big.md) — ${"x".repeat(24_990)}`);
  for (const [original, field] of [
    [fullLines, "line count"],
    [fullBytes, "byte count"],
  ] as const) {
    const directory: string = fixture();
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "MEMORY.md"), original);
    const result: Invocation = init(directory, "--scope", "shared", "--apply");
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`MEMORY.md: ${field}: received`);
    expect(result.output).toContain("index-<dominio>.md");
    expect(readFileSync(join(directory, "MEMORY.md"), "utf8")).toBe(original);
  }
});
