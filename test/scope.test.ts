import { expect, test } from "bun:test";
import { type MemorySources, runCli } from "../src/cli";
import { FakeMemoryReader, FakePreviousLogReader, markedIndex, memory } from "./fixtures";

function validate(index: string, files: Record<string, string> = {}): ReturnType<typeof runCli> {
  return runCli(
    ["fixture"],
    (): MemorySources => ({
      reader: new FakeMemoryReader({ ...files, "MEMORY.md": index }),
      previousLog: new FakePreviousLogReader(),
    }),
  );
}

test("scope defaults to project and only line two declares it", (): void => {
  expect(validate(markedIndex())).toEqual({
    exitCode: 0,
    output: ["ok: 0 memory files, MEMORY.md 1 lines, scope project"],
  });
  const index: string = markedIndex("# Index\n<!-- hypermemory-scope: shared -->\n");
  expect(validate(index).output).toEqual(["ok: 0 memory files, MEMORY.md 3 lines, scope project"]);
});

test("scope reports an invalid value and malformed marker at line two", (): void => {
  for (const [marker, received] of [
    ["<!-- hypermemory-scope: public -->", "public"],
    ["<!-- hypermemory-scope: shared", "shared"],
    ["<!-- hypermemory-scope:  -->", ""],
  ]) {
    expect(validate(markedIndex(`${marker}\r\n`, "\r\n"))).toEqual({
      exitCode: 1,
      output: [`MEMORY.md:2: scope: received "${received}", expected one of personal|project|shared`],
    });
  }
});

const FILES: Record<string, string> = {
  "habit.md": memory("habit", "type: user\nkind: profile"),
  "profile.md": memory("profile", "type: project\nkind: profile"),
  "rule.md": memory("rule", "type: feedback\nkind: rule\npersonal: true"),
  "string.md": memory("string", 'type: feedback\npersonal: "true"'),
  "team.md": memory("team", "type: feedback\npersonal: false"),
};

function withFiles(scope: string, files: Record<string, string>): ReturnType<typeof runCli> {
  const links: string[] = Object.keys(files).map((file: string): string => `- [Fact](${file})`);
  return validate(markedIndex(`<!-- hypermemory-scope: ${scope} -->\n${links.join("\n")}\n`), files);
}

test("shared forbids user, profile, and boolean personal feedback with the received field", (): void => {
  const result: ReturnType<typeof runCli> = withFiles("shared", FILES);
  const destination: string = "in the personal memory (~/.claude/hypermemory)";
  expect(result.exitCode).toBe(1);
  expect(result.output.filter((line: string): boolean => line.includes(": scope:"))).toEqual([
    `habit.md: scope: received metadata.type "user" in a shared memory, expected it ${destination}`,
    `profile.md: scope: received metadata.kind "profile" in a shared memory, expected it ${destination}`,
    `rule.md: scope: received metadata.personal true in a shared memory, expected it ${destination}`,
  ]);
});

test("personal and project allow personal memories and shared allows team feedback", (): void => {
  const { "profile.md": _invalid, ...valid } = FILES;
  for (const scope of ["personal", "project"]) {
    expect(withFiles(scope, valid)).toEqual({
      exitCode: 0,
      output: [`ok: 4 memory files, MEMORY.md 6 lines, scope ${scope}`],
    });
  }
  expect(withFiles("shared", { "team.md": FILES["team.md"] ?? "" }).exitCode).toBe(0);
});
