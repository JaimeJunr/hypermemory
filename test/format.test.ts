import { expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { FakeMemoryReader, FakePreviousLogReader } from "./fixtures";

function checkFormat(files: Readonly<Record<string, string>>): ReturnType<typeof runCli> {
  return runCli(["fixture"], () => ({
    reader: new FakeMemoryReader(files),
    previousLog: new FakePreviousLogReader(),
  }));
}

test("check reports a missing first-line marker and gives an upgrade hint", (): void => {
  const fixtures: readonly Readonly<Record<string, string>>[] = [
    {},
    { "MEMORY.md": "# Index\n<!-- hypermemory-format: 1 -->\n" },
  ];
  for (const files of fixtures) {
    expect(checkFormat(files)).toEqual({
      exitCode: 1,
      output: ["MEMORY.md:1: format: received missing, expected hypermemory-format 1; run hypermemory upgrade fixture"],
    });
  }
});

test("the upgrade hint quotes directory arguments with spaces or shell punctuation", (): void => {
  for (const [directory, expected] of [
    ["team memory", "'team memory'"],
    ["week's notes", "'week'\\''s notes'"],
    ["two\nlines", "'two'$'\\n''lines'"],
    ["-special", "./-special"],
  ] as const) {
    const result: ReturnType<typeof runCli> = runCli([directory], () => ({
      reader: new FakeMemoryReader({}),
      previousLog: new FakePreviousLogReader(),
    }));
    expect(result.output[0]).toEndWith(`run hypermemory upgrade ${expected}`);
  }
});

test("check reports an older explicit marker and gives an upgrade hint", (): void => {
  expect(checkFormat({ "MEMORY.md": "<!-- hypermemory-format: 0 -->\n" })).toEqual({
    exitCode: 1,
    output: ["MEMORY.md:1: format: received 0, expected hypermemory-format 1; run hypermemory upgrade fixture"],
  });
});

test("check rejects newer markers with an update hint", (): void => {
  for (const version of [2, 309, "9007199254740993"]) {
    expect(checkFormat({ "MEMORY.md": `<!-- hypermemory-format: ${version} -->\n` })).toEqual({
      exitCode: 1,
      output: [`MEMORY.md:1: format: received ${version}, expected at most 1; update Hypermemory`],
    });
  }
});

test("check accepts the current version with LF or CRLF", (): void => {
  for (const ending of ["\n", "\r\n"]) {
    expect(checkFormat({ "MEMORY.md": `<!-- hypermemory-format: 1 -->${ending}` })).toEqual({
      exitCode: 0,
      output: ["ok: 0 memory files, MEMORY.md 1 lines, scope project"],
    });
  }
});
