import { expect, test } from "bun:test";
import { CURRENT_FORMAT, formatMarker } from "../src/format";
import { FORMAT_MIGRATIONS, type RegisteredMigration } from "../src/upgrade/migrations";
import { migration as addMarker } from "../src/upgrade/migrations/0001-add-format-marker";
import { planUpgrade } from "../src/upgrade/plan";
import { markedIndex } from "./fixtures";

test("registry steps are contiguous from zero through the current format", (): void => {
  let from: number = 0;
  for (const { id, migration } of FORMAT_MIGRATIONS) {
    expect(migration.from).toBe(from);
    expect(migration.to).toBe(from + 1);
    expect(id).toMatch(new RegExp(`^${String(from + 1).padStart(4, "0")}-[a-z]+(?:-[a-z]+)*$`));
    from = migration.to;
  }
  expect(from).toBe(CURRENT_FORMAT);
});

test("migration 0001 prepends its historical marker and leaves all other contents intact", (): void => {
  for (const original of ["# Index", "# Index\r\nsecond", "<!-- hypermemory-format: 0 -->\n# Index"]) {
    const input: ReadonlyMap<string, string> = new Map([
      ["MEMORY.md", original],
      ["fact.md", "untouched"],
    ]);
    const migrated: ReadonlyMap<string, string> = addMarker.apply(input);
    const ending: string = original.includes("\r\n") ? "\r\n" : "\n";
    expect(migrated).toEqual(
      new Map([
        ["MEMORY.md", `<!-- hypermemory-format: 1 -->${ending}${original}`],
        ["fact.md", "untouched"],
      ]),
    );
    expect(input.get("MEMORY.md")).toBe(original);
  }
});

test("migration 0001 creates only the marker for an absent or empty index", (): void => {
  for (const input of [new Map<string, string>(), new Map([["MEMORY.md", ""]])]) {
    expect(addMarker.apply(input)).toEqual(new Map([["MEMORY.md", "<!-- hypermemory-format: 1 -->\n"]]));
  }
});

test("planning against two current directories is a no-op, including a previously upgraded directory", (): void => {
  const legacy: ReadonlyMap<string, string> = new Map([["MEMORY.md", "# Index"]]);
  const planned: ReturnType<typeof planUpgrade> = planUpgrade(legacy);
  for (const files of [
    planned.files,
    new Map([
      ["MEMORY.md", markedIndex()],
      ["LOG.md", "old"],
    ]),
  ]) {
    const again: ReturnType<typeof planUpgrade> = planUpgrade(files);
    expect(again.steps).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(again.files).toBe(files);
  }
});

function replacement(apply: RegisteredMigration["migration"]["apply"]): readonly RegisteredMigration[] {
  return [{ id: "0001-test", migration: { ...addMarker, apply } }];
}

test("planner rejects omitted file keys even when the emitted marker is valid", (): void => {
  const input: ReadonlyMap<string, string> = new Map([
    ["one.md", ""],
    ["two.md", ""],
  ]);
  for (const retained of ["one.md", "two.md"]) {
    const invalid: readonly RegisteredMigration[] = replacement(
      () =>
        new Map([
          ["MEMORY.md", markedIndex()],
          [retained, ""],
        ]),
    );
    expect(() => planUpgrade(input, invalid)).toThrow(/received .*expected every input file to be retained/);
  }
});

test("planner rejects changed paths that a sibling backup cannot cover", (): void => {
  for (const file of ["../other.md", "folder/page.md", "/absolute.md", ".", "..", "", "broken\0.md"]) {
    const invalid: readonly RegisteredMigration[] = replacement(
      () =>
        new Map([
          ["MEMORY.md", markedIndex()],
          [file, "new"],
        ]),
    );
    expect(() => planUpgrade(new Map(), invalid)).toThrow(
      /received .*expected a plain filename in the memory directory/,
    );
  }
});

test("planner rejects missing steps and wrong output versions", (): void => {
  const input: ReadonlyMap<string, string> = new Map();
  expect(() => planUpgrade(input, [])).toThrow(/received missing, expected a migration from format 0 to 1/);
  for (const version of [0, 2]) {
    const invalid: readonly RegisteredMigration[] = replacement(() => new Map([["MEMORY.md", formatMarker(version)]]));
    expect(() => planUpgrade(input, invalid)).toThrow(`received ${version}, expected hypermemory-format 1`);
  }
});

test("planner orders per-step changes by file and distinguishes creates from updates", (): void => {
  const input: ReadonlyMap<string, string> = new Map([
    ["z.md", "old"],
    ["a.md", "original"],
  ]);
  const modified: readonly RegisteredMigration[] = replacement(
    (files) => new Map([...files, ["z.md", "new"], ["MEMORY.md", markedIndex()], ["b.md", ""]]),
  );
  const plan: ReturnType<typeof planUpgrade> = planUpgrade(input, modified);
  expect(plan.steps.map(({ id, changes }) => [id, changes.map(({ file }) => file)])).toEqual([
    ["0001-test", ["MEMORY.md", "b.md", "z.md"]],
  ]);
  expect(plan.changes.map(({ file, before }) => [file, before])).toEqual([
    ["MEMORY.md", undefined],
    ["b.md", undefined],
    ["z.md", "old"],
  ]);
});

test("planner rejects markers higher than the current version without running a migration", (): void => {
  for (const version of [2, 380]) {
    expect(() => planUpgrade(new Map([["MEMORY.md", formatMarker(version)]]))).toThrow(
      `received ${version}, expected at most 1; update Hypermemory`,
    );
  }
});
