import { expect, test } from "bun:test";
import { splitFrontmatter } from "../src/frontmatter";
import { convertPages, type ConvertedPages, type MigratedPage } from "../src/migration/pages";
import type { Category, WikiPage } from "../src/migration/wiki";

function page(
  path: string, body: string, fields: Record<string, unknown> = {}, category: Category = { type: "project", kind: "concept" },
): WikiPage {
  return { path, body, fields, ...category };
}

function inspect(page: MigratedPage | undefined): { fields: unknown; body: string } {
  const { yaml, body } = splitFrontmatter(page?.content ?? "");
  return { fields: Bun.YAML.parse(yaml ?? ""), body };
}

test("names nested and accented files, prefixes collisions by kind, then numbers remaining collisions", (): void => {
  const sources: WikiPage[] = [
    page("profile/stack/JavaScript.md", "JS", {}, { type: "user", kind: "profile" }),
    page("decisions/Café_Azul.md", "decision", {}, { type: "project", kind: "decision" }),
    page("gotchas/cafe-azul.md", "gotcha", {}, { type: "project", kind: "gotcha" }),
    page("gotchas/cafe_azul.md", "another", {}, { type: "project", kind: "gotcha" }),
    page("notes/index-profile.md", "Reserved"),
    page("notes/日本語.md", "Japanese"),
  ];
  expect(convertPages(sources, "P", new Set()).pages.map(({ name }): string => name)).toEqual([
    "stack-javascript", "cafe-azul", "gotcha-cafe-azul", "gotcha-cafe-azul-2", "concept-index-profile", "memory",
  ]);
});

test("assigns the same collision names with pre-existing files and reports every skipped destination file", (): void => {
  const sources: WikiPage[] = [
    page("notes/x.md", "One"), page("notes/X!.md", "Two"), page("notes/x_.md", "Three"),
  ];
  const result: ConvertedPages = convertPages(sources, "P", new Set(["x.md", "concept-x-2.md"]));
  expect(result.pages.map(({ name }): string => name)).toEqual(["concept-x"]);
  expect(result.skips).toEqual([
    { target: "x.md", reason: "already exists" }, { target: "concept-x-2.md", reason: "already exists" },
  ]);
});

test("preserves pinned metadata and the exact body while using a compact abstract", (): void => {
  const body: string = "\r\n# Original heading\r\n\r\nOriginal text.  \r\n";
  const rule: WikiPage = page(
    "_rules/42.md", body, { title: "Rule: yes", abstract: "  An\n abstract   text ", pinned: true },
    { type: "feedback", kind: "rule" },
  );
  const { pages }: ConvertedPages = convertPages([rule], "A: Project", new Set());
  expect(pages[0]?.title).toBe("Rule: yes");
  expect(inspect(pages[0])).toEqual({
    fields: {
      name: "42", description: "An abstract text",
      metadata: { type: "feedback", kind: "rule", origin: "ai-memory:A: Project/_rules/42.md", pinned: true },
    },
    body,
  });
});

test("uses the title for a blank abstract and omits a false pinned flag", (): void => {
  const reference: WikiPage = page(
    "references/example.md", "# Original heading", { title: "Fallback\t title", abstract: " ", pinned: false },
    { type: "reference", kind: "reference" },
  );
  const { pages }: ConvertedPages = convertPages([reference], "A: Project", new Set());
  expect(pages[0]?.title).toBe("Fallback title");
  expect(inspect(pages[0]).fields).toEqual({
    name: "example", description: "Fallback title",
    metadata: { type: "reference", kind: "reference", origin: "ai-memory:A: Project/references/example.md" },
  });
});

test("falls back to the first H1, then the first non-empty body line, and caps at 200 characters", (): void => {
  const { pages }: ConvertedPages = convertPages([
    page("notes/heading.md", "Lead\n## H2\n# First   H1\n# Later"),
    page("notes/body.md", "\n  " + "🙂".repeat(201) + "\n#Not a heading"),
    page("notes/empty.md", "\r\n"),
  ], "P", new Set());
  expect(pages.map(({ title, description }): string[] => [title, description])).toEqual([
    ["heading", "First H1"], ["body", "🙂".repeat(200)], ["empty", "empty"],
  ]);
});

test("rewrites qualified paths with and without .md and a unique bare slug", (): void => {
  const { pages }: ConvertedPages = convertPages([
    page("notes/linker.md", " [[profile/stack/javascript.md]] / [[gotchas/javascript]] / [[only]] \r\n"),
    page("profile/stack/javascript.md", "Nested"),
    page("gotchas/javascript.md", "Other"),
    page("notes/only.md", "Unique"),
  ], "P", new Set());
  expect(inspect(pages[0]).body).toBe(" [[stack-javascript]] / [[javascript]] / [[only]] \r\n");
});

test("keeps unresolved, ambiguous, other-project, and skipped-target wikilinks as written", (): void => {
  const body: string = "[[missing]] [[x]] [[Another:notes/x]] [[profile/Existing.md]] [[nested-slug]] [[gotchas/x.md]]";
  const { pages }: ConvertedPages = convertPages([
    page("notes/linker.md", body), page("notes/x.md", "One"), page("gotchas/x.md", "Two"),
    page("profile/Existing.md", "Already exists"), page("profile/stack/nested-slug.md", "Nested"),
  ], "P", new Set(["existing.md"]));
  expect(inspect(pages[0]).body).toBe(body.replace("[[nested-slug]]", "[[stack-nested-slug]]").replace("[[gotchas/x.md]]", "[[concept-x]]"));
});

test("resolves superseded targets and writes the replacement's final collision name", (): void => {
  const { pages, issues }: ConvertedPages = convertPages([
    page("notes/x.md", "Different x"),
    page("gotchas/x.md", "Current x", {}, { type: "project", kind: "gotcha" }),
    page("notes/old.md", "Old", { status: "superseded", superseded_by: "[[gotchas/x.md]]" }),
    page("notes/older.md", "Older", { superseded: true, superseded_by: "old" }),
  ], "P", new Set());
  expect(issues).toEqual([]);
  expect(pages.map(({ superseded }): boolean => superseded)).toEqual([false, false, true, true]);
  expect(inspect(pages[2]).fields).toMatchObject({ metadata: { status: "superseded", superseded_by: "gotcha-x" } });
  expect(inspect(pages[3]).fields).toMatchObject({ metadata: { status: "superseded", superseded_by: "old" } });
});

test("keeps superseded pages active and reports missing, skipped, and self targets", (): void => {
  const { pages, issues }: ConvertedPages = convertPages([
    page("notes/old.md", "Old", { status: "superseded" }),
    page("notes/skipped.md", "Skipped", { superseded: true, superseded_by: "target" }),
    page("notes/self.md", "Self", { superseded: true, superseded_by: "self" }),
    page("notes/target.md", "Already exists"),
  ], "P", new Set(["target.md"]));
  expect(pages.map(({ superseded }): boolean => superseded)).toEqual([false, false, false]);
  const reported: readonly (readonly [string, string])[] = [
    ["old", "missing"], ["skipped", '"target"'], ["self", '"self"'],
  ];
  expect(issues).toEqual(reported.map(([file, value]) => ({
    file: "notes/" + file + ".md",
    message: "superseded_by: received " + value + ", expected another page migrated in this run",
  })));
});

test("emits Claude Code block frontmatter with deterministic metadata order", (): void => {
  const { pages }: ConvertedPages = convertPages([
    page("profile/old.md", "# Old\n", { abstract: "Use the current setting", pinned: true, superseded_by: "current" }, { type: "user", kind: "profile" }),
    page("profile/current.md", "# Current\n", {}, { type: "user", kind: "profile" }),
  ], "Team", new Set());
  expect(pages[0]?.content).toBe([
    "---", "name: old", "description: Use the current setting", "metadata:", "  type: user", "  kind: profile",
    "  origin: ai-memory:Team/profile/old.md", "  pinned: true", "  status: superseded", "  superseded_by: current",
    "---", "# Old", "",
  ].join("\n"));
  expect(inspect(pages[0]).fields).toEqual({
    name: "old", description: "Use the current setting",
    metadata: { type: "user", kind: "profile", origin: "ai-memory:Team/profile/old.md", pinned: true, status: "superseded", superseded_by: "current" },
  });
});

test("quotes YAML-sensitive strings and round-trips them without changing their types", (): void => {
  const values: readonly string[] = ["true", "NULL", "~", "42", "-1.5e+6", "0x2a", "[setting]", "a: b", "a # b", "a'b", 'a"b', "a\\b"];
  for (const value of values) {
    const { pages }: ConvertedPages = convertPages([page("notes/42.md", "Body", { abstract: value })], "Team", new Set());
    expect(pages[0]?.content).toContain("name: \"42\"\ndescription: " + JSON.stringify(value) + "\n");
    expect(inspect(pages[0]).fields).toEqual({
      name: "42", description: value,
      metadata: { type: "project", kind: "concept", origin: "ai-memory:Team/notes/42.md" },
    });
  }
});
