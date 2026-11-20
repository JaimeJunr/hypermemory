import { expect, test } from "bun:test";
import { runMigration } from "../src/migrate";
import { planIndexes } from "../src/migration/index-plan";
import { markedIndex } from "./fixtures";
import {
  FakeMigrationDestination,
  FakeMigrationIO,
  FakeMigrationSource,
  optRecord,
  projectFiles,
} from "./migrate-fixtures";

const WIKI_ARGS: readonly string[] = ["ai-memory", "--from", "/wiki", "--project", "Team", "/dest"];
const OPT_ARGS: readonly string[] = ["optmem", "--from", "/opt", "/dest"];
const PERSONAL_ARGS: readonly string[] = ["--personal-dest", "~/.claude/hypermemory"];

class FakeScopedMigrationIO extends FakeMigrationIO {
  readonly personal: FakeMigrationDestination = new FakeMigrationDestination();

  constructor(index?: string) {
    super(
      new FakeMigrationSource(
        projectFiles("/wiki/workspace/project", "Team", {
          "decisions/choice.md": "# Choice\n[[profile/habit]]\n",
          "profile/habit.md": "# Habit\n",
          "preferences/taste.md": "# Taste\n",
        }),
        { "/opt/LOG.txt": optRecord("#0 2026-11-19 Note") },
      ),
      new FakeMigrationDestination(index === undefined ? {} : { "MEMORY.md": index }),
    );
  }

  override destination(directory: string, source: string): FakeMigrationDestination {
    const main: FakeMigrationDestination = super.destination(directory, source);
    if (directory === "/dest") return main;
    main.directory = "/dest";
    this.personal.directory = directory;
    return this.personal;
  }
}

test("shared migration skips all personal pages with or without a pre-existing shared marker", (): void => {
  for (const index of [undefined, markedIndex("<!-- hypermemory-scope: shared -->\n")]) {
    const io: FakeScopedMigrationIO = new FakeScopedMigrationIO(index);
    const result: ReturnType<typeof runMigration> = runMigration([...WIKI_ARGS, "--scope", "shared", "--apply"], io);
    expect(result.exitCode).toBe(0);
    for (const path of ["profile/habit.md", "preferences/taste.md"]) {
      expect(result.output).toContain(`Skip: ${path} (personal page refused by shared scope; pass --personal-dest)`);
    }
    expect(Object.keys(io.target.files).sort()).toEqual(["LOG.md", "MEMORY.md", "choice.md"]);
    expect(io.target.files["choice.md"]).toContain("[[profile/habit]]");
  }
});

test("split migration previews paths, writes two separate indexes, validates both, and is idempotent", (): void => {
  const io: FakeScopedMigrationIO = new FakeScopedMigrationIO(markedIndex("<!-- hypermemory-scope: shared -->\n"));
  const args: string[] = [...WIKI_ARGS, ...PERSONAL_ARGS, "--scope", "project"];
  const dry: ReturnType<typeof runMigration> = runMigration(args, io);
  expect(dry.exitCode).toBe(0);
  expect(dry.output).toContain("Create file: /dest/choice.md");
  expect(dry.output).toContain("Create file: /home/test/.claude/hypermemory/habit.md");
  expect([io.target.writes.length, io.personal.writes.length]).toEqual([0, 0]);
  const applied: ReturnType<typeof runMigration> = runMigration([...args, "--apply"], io);
  expect(applied.exitCode).toBe(0);
  expect(applied.output).toContain("ok: 1 memory files, MEMORY.md 3 lines, scope shared");
  expect(applied.output).toContain("ok: 2 memory files, MEMORY.md 5 lines, scope personal");
  expect(io.target.files["MEMORY.md"]).toContain("(choice.md)");
  expect(io.target.files["MEMORY.md"]).not.toContain("(habit.md)");
  expect(io.personal.files["MEMORY.md"]).toContain("(habit.md)");
  expect(io.personal.files["MEMORY.md"]).toContain("(taste.md)");
  expect(io.personal.files["MEMORY.md"]).not.toContain("(choice.md)");
  expect(Object.keys(io.target.files).sort()).toEqual(["LOG.md", "MEMORY.md", "choice.md"]);
  expect(Object.keys(io.personal.files).sort()).toEqual(["LOG.md", "MEMORY.md", "habit.md", "taste.md"]);
  expect(runMigration([...args, "--apply"], io).exitCode).toBe(0);
  expect([io.target.writes.length, io.personal.writes.length]).toEqual([1, 1]);
});

test("migration validates both destinations even when one has issues", (): void => {
  const io: FakeScopedMigrationIO = new FakeScopedMigrationIO(markedIndex("<!-- hypermemory-scope: shared -->\n"));
  Object.assign(io.personal.files, {
    "MEMORY.md": markedIndex("<!-- hypermemory-scope: personal -->\n"),
    "LOG.md": "bad\n",
  });
  const result: ReturnType<typeof runMigration> = runMigration([...WIKI_ARGS, ...PERSONAL_ARGS, "--apply"], io);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("ok: 1 memory files, MEMORY.md 3 lines, scope shared");
  expect(result.output.join("\n")).toContain('LOG.md:1: line format: received "bad"');
});

test("OptMem marks new destinations with default or explicit scope and never changes an existing index", (): void => {
  for (const [flags, scope] of [
    [[], "project"],
    [["--scope", "personal"], "personal"],
  ] as const) {
    const io: FakeScopedMigrationIO = new FakeScopedMigrationIO();
    expect(runMigration([...OPT_ARGS, ...flags, "--apply"], io).exitCode).toBe(0);
    const index: string | undefined = io.target.files["MEMORY.md"];
    expect(index?.split("\n")[1]).toBe(`<!-- hypermemory-scope: ${scope} -->`);
    expect(runMigration([...OPT_ARGS, "--scope", "shared", "--apply"], io).exitCode).toBe(0);
    expect(io.target.files["MEMORY.md"]).toBe(index);
  }
});

test("migration refuses a malformed scope or a shared personal destination before writing", (): void => {
  const io: FakeScopedMigrationIO = new FakeScopedMigrationIO(markedIndex("<!-- hypermemory-scope: invalid -->\n"));
  expect(runMigration([...WIKI_ARGS, "--apply"], io).output.join()).toContain('MEMORY.md:2: scope: received "invalid"');
  io.target.files["MEMORY.md"] = markedIndex();
  io.personal.files["MEMORY.md"] = markedIndex("<!-- hypermemory-scope: shared -->\n");
  expect(runMigration([...WIKI_ARGS, ...PERSONAL_ARGS, "--apply"], io).output.join()).toContain(
    'scope: received "shared"',
  );
  expect([io.target.writes.length, io.personal.writes.length]).toEqual([0, 0]);
});

test("overflow archiving retains line two for explicit shared and personal indexes", (): void => {
  for (const scope of ["shared", "personal"]) {
    const marker: string = `<!-- hypermemory-scope: ${scope} -->\n`;
    const original: string = markedIndex(marker + "entry\n".repeat(149));
    const changes: ReturnType<typeof planIndexes> = planIndexes(new Map([["MEMORY.md", original]]), [
      { name: "fact", kind: "concept", title: "Fact", description: "Fact" },
    ]);
    expect(changes.find(({ file }): boolean => file === "MEMORY.md")?.content).toStartWith(markedIndex(marker));
    expect(changes.find(({ file }): boolean => file === "index-existing.md")?.content).toBe(original);
  }
});

test("migration rejects invalid scope values and flags without a destination", (): void => {
  for (const args of [
    [...WIKI_ARGS, "--scope", "public"],
    [...WIKI_ARGS, "--personal-dest"],
    ["ai-memory", "--from", "/wiki", "--list", "--scope", "shared"],
    ["ai-memory", "--from", "/wiki", "--list", ...PERSONAL_ARGS],
  ]) {
    const io: FakeScopedMigrationIO = new FakeScopedMigrationIO();
    const result: ReturnType<typeof runMigration> = runMigration(args, io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toContain("personal|project|shared");
    expect(io.opened).toEqual([]);
  }
});
