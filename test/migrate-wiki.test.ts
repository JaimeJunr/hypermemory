import { expect, test } from "bun:test";
import { findProjects, type ProjectPages, readProject, type WikiPage, type WikiProject } from "../src/migration/wiki";
import { FakeWikiReader, projectFiles } from "./migrate-fixtures";

const DIRECTORY: string = "/wiki/workspace-uuid/project-uuid";
const PROJECT: WikiProject = { directory: DIRECTORY, workspace: "Test space", name: "Alpha" };

test("discovers projects via manifests in multiple workspaces, including a project with zero pages", (): void => {
  const wiki: FakeWikiReader = new FakeWikiReader({
    ...projectFiles(DIRECTORY, "Alpha", { "notes/one.md": "# One" }),
    ...projectFiles("/wiki/second/uuid", "Empty", {}),
    "/wiki/.git/random": "",
    "/wiki/workspace-uuid/no-meta/notes/one.md": "# Ignored",
  });
  expect(findProjects(wiki, "/wiki")).toEqual([
    { directory: "/wiki/second/uuid", workspace: "Test space", name: "Empty" },
    PROJECT,
  ]);
});

test("ignores folders without a workspace manifest and reports an absent wiki", (): void => {
  const wiki: FakeWikiReader = new FakeWikiReader({
    "/wiki/without-workspace/uuid/_meta.md": "---\nproject: Phantom\n---\n",
    "/wiki/empty-workspace/_meta.md": "---\nworkspace: Neutral\n---\n",
  });
  expect(findProjects(wiki, "/wiki")).toEqual([]);
  expect((): WikiProject[] => findProjects(wiki, "/missing")).toThrow('received "/missing", expected a wiki directory');
});

const PAGE_CATEGORIES: Record<string, string> = {
  "_rules/a.md": "feedback/rule",
  "rules/a.md": "feedback/rule",
  "profile/stack/javascript.md": "user/profile",
  "preferences/a.md": "user/profile",
  "decisions/a.md": "project/decision",
  "gotchas/a.md": "project/gotcha",
  "procedures/a.md": "project/procedure",
  "concepts/a.md": "project/concept",
  "notes/a.md": "project/concept",
  "references/a.md": "reference/reference",
};

test("reads nested pages, maps every supported folder, and preserves the body after the closing marker", (): void => {
  const body: string = "\r\n# Test\r\n\r\nOriginal text  \r\n";
  const input: Record<string, string> = Object.fromEntries(
    Object.keys(PAGE_CATEGORIES).map((path: string): [string, string] => [
      path,
      `\uFEFF---\r\npinned: true\r\ntitle: Test\r\n---\r\n${body}`,
    ]),
  );
  const result: ProjectPages = readProject(new FakeWikiReader(projectFiles(DIRECTORY, "Alpha", input)), PROJECT);
  expect(
    Object.fromEntries(
      result.pages.map((page: WikiPage): [string, string] => [page.path, `${page.type}/${page.kind}`]),
    ),
  ).toEqual(PAGE_CATEGORIES);
  for (const { fields, body: actual } of result.pages) {
    expect(fields).toEqual({ pinned: true, title: "Test" });
    expect(actual).toBe(body);
  }
});

const PAGES_WITH_SKIPS: Record<string, string> = {
  "index.md": "index",
  "log-01.md": "log",
  "notes/live.md": "# Keep",
  "sessions/archive/session.md": "session",
  "_pending/p.md": "pending",
  "_lint/l.md": "lint",
  "auto-improve/result.md": "auto",
  "unknown/deep/u.md": "unknown",
  "notes/image.png": "",
};

test("reports skipped pages by folder and root file without reading them", (): void => {
  const wiki: FakeWikiReader = new FakeWikiReader(projectFiles(DIRECTORY, "Alpha", PAGES_WITH_SKIPS));
  const result: ProjectPages = readProject(wiki, PROJECT);
  expect(result.pages.map(({ path }): string => path)).toEqual(["notes/live.md"]);
  expect(result.skips.map(({ reason }): string => reason).sort()).toEqual([
    "folder _lint",
    "folder _pending",
    "folder auto-improve",
    "folder sessions",
    "non-Markdown file",
    "root file",
    "root file",
    "root file",
    "unknown folder unknown",
  ]);
  expect(wiki.reads).toEqual([`${DIRECTORY}/notes/live.md`]);
});

test("reports malformed YAML and accepts pages without frontmatter or with an empty block", (): void => {
  const wiki: FakeWikiReader = new FakeWikiReader(
    projectFiles(DIRECTORY, "Alpha", {
      "notes/broken.md": "---\ntitle: [\n---\n# Broken",
      "notes/no-fields.md": "# No fields\n",
      "notes/empty-block.md": "---\n---\n# Empty block",
    }),
  );
  const result: ProjectPages = readProject(wiki, PROJECT);
  expect(result.pages.map(({ body }): string => body)).toEqual(["# Empty block", "# No fields\n"]);
  expect(result.skips).toEqual([
    { target: "_meta.md", reason: "root file" },
    { target: "notes/broken.md", reason: "invalid frontmatter" },
  ]);
  expect(result.issues).toEqual([
    { file: "notes/broken.md", message: expect.stringMatching(/received .*expected a YAML mapping/) },
  ]);
});

test("discovers projects whose workspace manifest is plain YAML while requiring project frontmatter", (): void => {
  const wiki: FakeWikiReader = new FakeWikiReader({
    "/wiki/plain/_meta.md": "workspace: Plain\n",
    "/wiki/plain/first/_meta.md": "---\nproject: Valid\n---\n",
    "/wiki/plain/second/_meta.md": "project: Invalid\n",
    "/wiki/invalid/_meta.md": "workspace: [\n",
    "/wiki/invalid/third/_meta.md": "---\nproject: Hidden\n---\n",
  });
  expect(findProjects(wiki, "/wiki")).toEqual([{ directory: "/wiki/plain/first", workspace: "Plain", name: "Valid" }]);
});
