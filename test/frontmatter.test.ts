import { expect, test } from "bun:test";
import type { Issue, ValidationResult } from "../src/validator";
import { check, memory } from "./fixtures";

function checkFrontmatter(content: string): readonly Issue[] {
  const result: ValidationResult = check({ "fact.md": content, "MEMORY.md": "[fact](fact.md)" });
  return result.issues;
}

test("frontmatter accepts native YAML, optional kind, and all type/kind pairs", (): void => {
  const pairs: readonly (readonly [string, string | undefined])[] = [
    ["user", "profile"],
    ["feedback", "rule"],
    ["reference", "reference"],
    ["project", "decision"],
    ["project", "gotcha"],
    ["project", "procedure"],
    ["project", "concept"],
    ["project", "session"],
    ["project", undefined],
  ];
  for (const [type, kind] of pairs) {
    const metadata: string = kind ? `type: ${type}\nkind: ${kind}\nstatus: open` : `type: ${type}`;
    expect(checkFrontmatter(memory("fact-2026", metadata, '"A fact: with punctuation"'))).toEqual([]);
  }
});

test("frontmatter finds memory files and excludes reserved Markdown and unrelated files", (): void => {
  const result: ValidationResult = check({
    "MEMORY.md": "[fact](arbitrary.md)\n[Index](index-work.md)",
    "index-work.md": "# Work",
    "arbitrary.md": memory("a-fact"),
    "notes.txt": "not Markdown",
  });
  expect(result.memoryFiles).toBe(1);
  expect(result.issues).toEqual([]);
});

test("frontmatter rejects missing delimiters, invalid YAML, and non-mapping YAML", (): void => {
  for (const content of ["Body", "---\nname: [\n---", "---\n- fact\n---", "---\nname: fact"]) {
    const issues: readonly Issue[] = checkFrontmatter(content);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: "fact.md",
      message: expect.stringMatching(/frontmatter: received .*expected/),
    });
  }
});

test("frontmatter reports invalid required fields individually", (): void => {
  expect(checkFrontmatter(memory("Not_Kebab", "type: projetc", '"  "'))).toEqual([
    { file: "fact.md", message: 'name: received "Not_Kebab", expected kebab-case' },
    { file: "fact.md", message: 'description: received "  ", expected a non-empty string' },
    { file: "fact.md", message: 'metadata.type: received "projetc", expected one of user|feedback|project|reference' },
  ]);
  expect(checkFrontmatter("---\n{}\n---").map((issue: Issue): string => issue.message)).toEqual([
    "name: received missing, expected kebab-case",
    "description: received missing, expected a non-empty string",
    "metadata.type: received missing, expected one of user|feedback|project|reference",
  ]);
});

test("frontmatter rejects kind values outside the given type, including null", (): void => {
  expect(checkFrontmatter(memory("fact", "type: user\nkind: rule"))).toEqual([
    { file: "fact.md", message: 'metadata.kind: received "rule", expected one of profile for metadata.type "user"' },
  ]);
  expect(checkFrontmatter(memory("fact", "type: reference\nkind: null"))).toEqual([
    {
      file: "fact.md",
      message: 'metadata.kind: received null, expected one of reference for metadata.type "reference"',
    },
  ]);
});

// Âncora YAML cíclica ficou fora: o parser do Bun 1.3 recusa o bloco inteiro e o 1.4 aceita.
test("frontmatter rejects non-finite and non-string field values", (): void => {
  const content: string = ["---", "name: 42", "description: .inf", "metadata: { type: project }", "---"].join("\n");
  expect(checkFrontmatter(content)).toEqual([
    { file: "fact.md", message: expect.stringMatching(/^name: received 42.*expected kebab-case$/) },
    { file: "fact.md", message: "description: received Infinity, expected a non-empty string" },
  ]);
});

test("frontmatter accepts a BOM and CRLF but rejects a block after the file body", (): void => {
  const frontmatter: string = memory("fact");
  expect(checkFrontmatter(`\uFEFF${frontmatter.replaceAll("\n", "\r\n")}`)).toEqual([]);
  expect(checkFrontmatter(`Body\n${frontmatter}`)).toEqual([
    { file: "fact.md", message: expect.stringMatching(/^frontmatter: received .*expected/) },
  ]);
});
