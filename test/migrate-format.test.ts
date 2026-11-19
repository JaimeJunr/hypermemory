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

const WIKI: string = "/wiki/workspace/project";
const OPT_ARGS: readonly string[] = ["optmem", "--from", "/opt", "/dest"];
const WIKI_ARGS: readonly string[] = ["ai-memory", "--from", "/wiki", "--project", "Team", "/dest"];

function migrationIO(files: Record<string, string>): FakeMigrationIO {
  const source: FakeMigrationSource = new FakeMigrationSource(
    projectFiles(WIKI, "Team", { "notes/fact.md": "# Fact" }),
    { "/opt/LOG.txt": optRecord("#0 2026-11-19 New") },
  );
  return new FakeMigrationIO(source, new FakeMigrationDestination(files));
}

test("both importers refuse to write to legacy destinations with either a missing or older marker", (): void => {
  for (const args of [OPT_ARGS, WIKI_ARGS]) {
    for (const index of ["# Index\n", "<!-- hypermemory-format: 0 -->\n"]) {
      const files: Record<string, string> = { "MEMORY.md": index };
      const io: FakeMigrationIO = migrationIO(files);
      const result: ReturnType<typeof runMigration> = runMigration([...args, "--apply"], io);
      expect(result.exitCode).toBe(1);
      expect(result.output.join()).toContain("expected hypermemory-format 1; run hypermemory upgrade /dest");
      expect(io.target.writes).toEqual([]);
      expect(io.target.files).toEqual({ "MEMORY.md": index });
    }
  }
});

test("both importers refuse future destinations and preserve their contents", (): void => {
  for (const args of [OPT_ARGS, WIKI_ARGS]) {
    const files: Record<string, string> = { "MEMORY.md": "<!-- hypermemory-format: 2 -->\n" };
    const io: FakeMigrationIO = migrationIO(files);
    const result: ReturnType<typeof runMigration> = runMigration([...args, "--apply"], io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join()).toContain("received 2, expected at most 1; update Hypermemory");
    expect(io.target.writes).toEqual([]);
  }
});

test("overflow archiving retains the version marker in the main index and preserves the old copy", (): void => {
  for (const full of ["entry\n".repeat(149), "é".repeat(12500)]) {
    const original: string = markedIndex(full);
    const changes: ReturnType<typeof planIndexes> = planIndexes(new Map([["MEMORY.md", original]]), [
      { name: "fact", kind: "concept", title: "Fact", description: "Fact" },
    ]);
    expect(changes.find(({ file }): boolean => file === "MEMORY.md")?.content).toStartWith(markedIndex());
    expect(changes.find(({ file }): boolean => file === "index-existing.md")?.content).toBe(original);
  }
});
