import { join } from "node:path";
import { isMapping, nonEmptyString, splitFrontmatter } from "../frontmatter";
import { type Issue, receivedIssue } from "../issue";

export interface WikiEntry {
  readonly name: string;
  readonly directory: boolean;
}

export interface WikiReader {
  entries(directory: string): readonly WikiEntry[] | undefined;
  read(file: string): string;
}

export interface WikiProject {
  readonly directory: string;
  readonly workspace: string;
  readonly name: string;
}

export interface Category {
  readonly type: "feedback" | "user" | "project" | "reference";
  readonly kind: "rule" | "profile" | "decision" | "gotcha" | "procedure" | "concept" | "reference";
}

export interface WikiPage extends Category {
  readonly path: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly body: string;
}

export interface Skipped {
  readonly target: string;
  readonly reason: string;
}

export interface ProjectPages {
  readonly pages: readonly WikiPage[];
  readonly skips: readonly Skipped[];
  readonly issues: readonly Issue[];
}

const CATEGORIES: ReadonlyMap<string, Category> = new Map([
  ["_rules", { type: "feedback", kind: "rule" }],
  ["rules", { type: "feedback", kind: "rule" }],
  ["profile", { type: "user", kind: "profile" }],
  ["preferences", { type: "user", kind: "profile" }],
  ["decisions", { type: "project", kind: "decision" }],
  ["gotchas", { type: "project", kind: "gotcha" }],
  ["procedures", { type: "project", kind: "procedure" }],
  ["concepts", { type: "project", kind: "concept" }],
  ["notes", { type: "project", kind: "concept" }],
  ["references", { type: "reference", kind: "reference" }],
]);

const EXCLUDED_FOLDERS: ReadonlySet<string> = new Set(["sessions", "_pending", "_lint", "auto-improve"]);

function parseFields(yaml: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const fields: unknown = yaml.trim() === "" ? {} : Bun.YAML.parse(yaml);
    return isMapping(fields) ? fields : undefined;
  } catch {
    return undefined;
  }
}

function manifestName(
  reader: WikiReader,
  directory: string,
  field: "workspace" | "project",
  entries: readonly WikiEntry[],
): string | undefined {
  if (!entries.some((entry: WikiEntry): boolean => !entry.directory && entry.name === "_meta.md")) return undefined;
  const content: string = reader.read(join(directory, "_meta.md"));
  const { yaml } = splitFrontmatter(content);
  const fields: Readonly<Record<string, unknown>> | undefined = parseFields(
    yaml ?? (field === "workspace" ? content : ""),
  );
  const name: unknown = fields?.[field];
  return nonEmptyString(name) ? name : undefined;
}

function directories(entries: readonly WikiEntry[]): string[] {
  const children: WikiEntry[] = entries.filter((entry: WikiEntry): boolean => entry.directory);
  return children.map((entry: WikiEntry): string => entry.name).sort();
}

function workspaceProjects(reader: WikiReader, directory: string): WikiProject[] {
  const entries: readonly WikiEntry[] = reader.entries(directory) ?? [];
  const workspace: string | undefined = manifestName(reader, directory, "workspace", entries);
  if (workspace === undefined) return [];
  const projects: WikiProject[] = [];
  for (const folder of directories(entries)) {
    const project: string = join(directory, folder);
    const name: string | undefined = manifestName(reader, project, "project", reader.entries(project) ?? []);
    if (name !== undefined) projects.push({ directory: project, workspace, name });
  }
  return projects;
}

export function findProjects(reader: WikiReader, root: string): WikiProject[] {
  const entries: readonly WikiEntry[] | undefined = reader.entries(root);
  if (entries === undefined) throw new Error(receivedIssue(root, "wiki", root, "a wiki directory").message);
  return directories(entries).flatMap((name: string): WikiProject[] => workspaceProjects(reader, join(root, name)));
}

function* projectPaths(reader: WikiReader, directory: string, prefix: string = ""): Generator<string> {
  const entries: WikiEntry[] = [...(reader.entries(directory) ?? [])];
  entries.sort((a: WikiEntry, b: WikiEntry): number => (a.name < b.name ? -1 : Number(a.name > b.name)));
  for (const entry of entries) {
    const path: string = prefix + entry.name;
    if (entry.directory) yield* projectPaths(reader, join(directory, entry.name), `${path}/`);
    else yield path;
  }
}

function skipReason(path: string, folder: string): string {
  if (!path.includes("/")) return "root file";
  if (!CATEGORIES.has(folder)) return (EXCLUDED_FOLDERS.has(folder) ? "folder " : "unknown folder ") + folder;
  return "non-Markdown file";
}

function readPage(reader: WikiReader, directory: string, path: string, category: Category): WikiPage | Issue {
  const content: string = reader.read(join(directory, path));
  const { yaml, body } = splitFrontmatter(content);
  const hasOpening: boolean = /^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(content);
  const fields: Readonly<Record<string, unknown>> | undefined =
    yaml !== undefined ? parseFields(yaml) : hasOpening ? undefined : {};
  return fields === undefined
    ? receivedIssue(path, "frontmatter", yaml ?? content, "a YAML mapping between --- delimiters")
    : { ...category, path, fields, body };
}

export function readProject(reader: WikiReader, project: WikiProject): ProjectPages {
  const pages: WikiPage[] = [];
  const skips: Skipped[] = [];
  const issues: Issue[] = [];
  for (const path of projectPaths(reader, project.directory)) {
    const folder: string = path.split("/", 1)[0] ?? "";
    const category: Category | undefined = CATEGORIES.get(folder);
    if (category === undefined || !path.endsWith(".md")) {
      skips.push({ target: path, reason: skipReason(path, folder) });
      continue;
    }
    const page: WikiPage | Issue = readPage(reader, project.directory, path, category);
    if ("body" in page) pages.push(page);
    else {
      skips.push({ target: path, reason: "invalid frontmatter" });
      issues.push(page);
    }
  }
  return { pages, skips, issues };
}
