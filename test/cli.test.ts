import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MemorySources, openDirectory, runCli } from "../src/cli";
import { FakeMemoryReader, FakePreviousLogReader, markedIndex, memory } from "./fixtures";

function openFixture(directory: string): MemorySources {
  if (directory !== "fixture") throw new Error("unknown fixture");
  return {
    reader: new FakeMemoryReader({
      "MEMORY.md": markedIndex("[Fact](fact.md)\n"),
      "fact.md": memory("fact"),
    }),
    previousLog: new FakePreviousLogReader(),
  };
}

test("CLI opens a real memory directory from disk", (): void => {
  const directory = mkdtempSync(join(tmpdir(), "hypermemory-cli-"));
  try {
    writeFileSync(join(directory, "MEMORY.md"), markedIndex("[Fact](fact.md)\n"));
    writeFileSync(join(directory, "fact.md"), memory("fact"));
    expect(runCli([directory], openDirectory)).toEqual({
      exitCode: 0,
      output: ["ok: 1 memory files, MEMORY.md 2 lines, scope project"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI returns exit zero and a count summary for a valid directory", (): void => {
  expect(runCli(["fixture"], openFixture)).toEqual({
    exitCode: 0,
    output: ["ok: 1 memory files, MEMORY.md 2 lines, scope project"],
  });
});

test("CLI returns exit one and one output line per issue, with log line numbers", (): void => {
  const result: ReturnType<typeof runCli> = runCli(
    ["fixture"],
    (_directory: string): MemorySources => ({
      reader: new FakeMemoryReader({
        "MEMORY.md": markedIndex("[Missing](missing.md)"),
        "LOG.md": "<!-- comment -->\ninvalid",
      }),
      previousLog: new FakePreviousLogReader(),
    }),
  );
  expect(result).toEqual({
    exitCode: 1,
    output: [
      'MEMORY.md: link target: received "missing.md", expected an existing Markdown file in the memory directory',
      'LOG.md:2: line format: received "invalid", expected YYYY-MM-DD | <kind> | <text>',
    ],
  });
});

test("CLI requires one directory argument and reports opening failures", (): void => {
  for (const args of [[], ["fixture", "extra"]]) {
    expect(runCli(args, openFixture)).toEqual({
      exitCode: 1,
      output: ["usage: bun run src/cli.ts <memory-dir>"],
    });
  }
  expect(runCli(["missing"], openFixture)).toEqual({
    exitCode: 1,
    output: ['missing: could not validate directory: "unknown fixture"'],
  });
});
