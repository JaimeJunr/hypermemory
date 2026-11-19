import { expect, test } from "bun:test";
import { runCli, type MemorySources } from "../src/cli";
import { FakeMemoryReader, FakePreviousLogReader, memory } from "./fixtures";

function openFixture(directory: string): MemorySources {
  if (directory !== "fixture") throw new Error("unknown fixture");
  return {
    reader: new FakeMemoryReader({
      "MEMORY.md": "[Fact](fact.md)\n",
      "fact.md": memory("fact"),
    }),
    previousLog: new FakePreviousLogReader(),
  };
}

test("CLI returns exit zero and a count summary for a valid directory", (): void => {
  expect(runCli(["fixture"], openFixture)).toEqual({
    exitCode: 0,
    output: ["ok: 1 memory files, MEMORY.md 1 lines"],
  });
});

test("CLI returns exit one and one output line per issue, with log line numbers", (): void => {
  const result: ReturnType<typeof runCli> = runCli(["fixture"], (_directory: string): MemorySources => ({
    reader: new FakeMemoryReader({
      "MEMORY.md": "[Missing](missing.md)",
      "LOG.md": "<!-- comment -->\ninvalid",
    }),
    previousLog: new FakePreviousLogReader(),
  }));
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
