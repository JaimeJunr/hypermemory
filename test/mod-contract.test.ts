import { expect, test } from "bun:test";
import { isPersonalContent } from "../mod/hooks/scope-rules";
import { type MemorySources, runCli } from "../src/cli";
import { FakeMemoryReader, FakePreviousLogReader, markedIndex } from "./fixtures";

// O mod barra na hora da gravação e o validador barra no check: os dois têm de concordar sobre o que é pessoal.
const TYPES: readonly string[] = ["user", '"user"', "feedback", "project", "reference"];
const KINDS: readonly (string | undefined)[] = ["profile", "rule", "decision", undefined];
const PERSONAL: readonly (string | undefined)[] = ["true", "false", '"true"', undefined];
const NEWLINES: readonly string[] = ["\n", "\r\n"];

interface Case {
  readonly label: string;
  readonly content: string;
}

function fields(type: string, kind: string | undefined, personal: string | undefined): string[] {
  const pairs: string[] = [`type: ${type}`];
  if (kind !== undefined) pairs.push(`kind: ${kind}`);
  if (personal !== undefined) pairs.push(`personal: ${personal}`);
  return pairs;
}

function render(pairs: readonly string[], flow: boolean, newline: string): string {
  const metadata: string = flow
    ? `metadata: {${pairs.join(", ")}}`
    : ["metadata:", ...pairs.map((p) => `  ${p}`)].join(newline);
  return ["---", "name: fact", "description: A fact", metadata, "---", "Body.", ""].join(newline);
}

function cases(): Case[] {
  const combos: [string, string | undefined, string | undefined, boolean, string][] = TYPES.flatMap((type) =>
    KINDS.flatMap((kind) =>
      PERSONAL.flatMap((personal) =>
        [false, true].flatMap((flow) => NEWLINES.map((newline) => [type, kind, personal, flow, newline] as const)),
      ),
    ),
  ) as [string, string | undefined, string | undefined, boolean, string][];
  return combos.map(([type, kind, personal, flow, newline]): Case => {
    const pairs: string[] = fields(type, kind, personal);
    return {
      label: `${pairs.join(",")} flow=${flow} crlf=${newline === "\r\n"}`,
      content: render(pairs, flow, newline),
    };
  });
}

function validatorFlags(content: string): boolean {
  const reader: FakeMemoryReader = new FakeMemoryReader({
    "MEMORY.md": markedIndex("<!-- hypermemory-scope: shared -->\n- [Fact](fact.md)\n"),
    "fact.md": content,
  });
  const result = runCli(["fixture"], (): MemorySources => ({ reader, previousLog: new FakePreviousLogReader() }));
  return result.output.some((line: string): boolean => line.startsWith("fact.md: scope:"));
}

test("the mod and the validator agree on every combination of type, kind, personal, style and newline", (): void => {
  const disagreements: string[] = cases()
    .filter(({ content }: Case): boolean => isPersonalContent(content) !== validatorFlags(content))
    .map(({ label }: Case): string => label);
  expect(disagreements).toEqual([]);
  expect(cases().filter(({ content }: Case): boolean => validatorFlags(content)).length).toBeGreaterThan(0);
});

test("a personal-looking line outside the frontmatter is not personal for either side", (): void => {
  const content: string = render(["type: project", "kind: decision"], false, "\n").replace(
    "Body.",
    "type: user\nkind: profile",
  );
  expect(isPersonalContent(content)).toBe(false);
  expect(validatorFlags(content)).toBe(false);
});
