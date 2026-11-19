import { posix } from "node:path";
import { nonEmptyString } from "../frontmatter";
import { type Issue, receivedIssue } from "../issue";
import { markdownLines } from "../markdown";
import type { Category, Skipped, WikiPage } from "./wiki";

export interface MigratedPage extends Category {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly content: string;
  readonly superseded: boolean;
}

export interface ConvertedPages {
  readonly pages: readonly MigratedPage[];
  readonly existing: readonly NamedPage[];
  readonly skips: readonly Skipped[];
  readonly issues: readonly Issue[];
}

export interface NamedPage extends WikiPage {
  readonly name: string;
}

type LinkResolver = (reference: string) => string | undefined;

function slug(path: string): string {
  const ascii: string = path.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "memory";
}

function uniqueName(page: WikiPage, used: ReadonlySet<string>): string {
  const slugPath: string = page.path.slice(page.path.indexOf("/") + 1, -3);
  const base: string = slug(slugPath);
  if (!base.startsWith("index-") && !used.has(base)) return base;
  const prefixed: string = `${page.kind}-${base}`;
  if (!used.has(prefixed)) return prefixed;
  let suffix: number = 2;
  while (used.has(`${prefixed}-${suffix}`)) suffix++;
  return `${prefixed}-${suffix}`;
}

function namePages(pages: readonly WikiPage[]): NamedPage[] {
  const used: Set<string> = new Set();
  return pages.map((page: WikiPage): NamedPage => {
    const name: string = uniqueName(page, used);
    used.add(name);
    return { ...page, name };
  });
}

function linkTargets(pages: readonly NamedPage[], pending: ReadonlySet<string>): LinkResolver {
  const targets: Map<string, string | undefined> = new Map();
  for (const { path, name } of pages) {
    const qualified: string = path.slice(0, -3);
    const bare: string = posix.basename(qualified);
    targets.set(qualified, name);
    targets.set(bare, targets.has(bare) ? undefined : name);
  }
  return (reference: string): string | undefined => {
    const target: string | undefined = targets.get(reference.replace(/\.md$/, ""));
    return target !== undefined && pending.has(target) ? target : undefined;
  };
}

function oneLine(value: unknown): string | undefined {
  if (!nonEmptyString(value)) return undefined;
  return value.trim().replace(/\s+/gu, " ");
}

function descriptionFor(page: NamedPage): string {
  const heading: string | undefined = /^ {0,3}#[ \t]+(.+)$/m.exec(page.body)?.[1]?.replace(/[ \t]+#+[ \t]*$/, "");
  const firstBodyLine: string | undefined = markdownLines(page.body).find(nonEmptyString);
  const description: string =
    oneLine(page.fields.abstract) ??
    oneLine(page.fields.title) ??
    oneLine(heading) ??
    oneLine(firstBodyLine) ??
    page.name;
  return [...description].slice(0, 200).join("").trimEnd();
}

export function pageOrigin(project: string, path: string): string {
  const projectRoot: string = `ai-memory:${project}/`;
  return projectRoot + path;
}

function replacementFor(page: NamedPage, resolve: LinkResolver, issues: Issue[]): string | undefined {
  const { status, superseded, superseded_by: reference } = page.fields;
  if (status !== "superseded" && superseded !== true && !nonEmptyString(reference)) return undefined;
  const ref: string | undefined = nonEmptyString(reference)
    ? reference.trim().replace(/^\[\[(.*)\]\]$/, "$1")
    : undefined;
  const target: string | undefined = ref === undefined ? undefined : resolve(ref);
  if (target !== undefined && target !== page.name) return target;
  issues.push(receivedIssue(page.path, "superseded_by", reference, "another page migrated in this run"));
  return undefined;
}

const YAML_INDICATOR: RegExp = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_KEYWORD: RegExp = /^(?:true|false|null|~|[+-]?\.(?:inf|nan))$/i;
const YAML_NUMBER: RegExp = /^[+-]?(?:0[xob][\da-f_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:e[+-]?\d[\d_]*)?)$/i;

function yamlScalar(value: string): string {
  const needsQuotes: boolean =
    value === "" ||
    value !== value.trim() ||
    YAML_INDICATOR.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: valor YAML com caractere de controle C0 precisa ir entre aspas e escapado.
    /:[\s]|:$|\s#|['"\\\x00-\x1f]/.test(value) ||
    YAML_KEYWORD.test(value) ||
    YAML_NUMBER.test(value);
  return needsQuotes ? JSON.stringify(value) : value;
}

function emitFrontmatter(
  page: NamedPage,
  description: string,
  project: string,
  replacement: string | undefined,
): string {
  const lines: string[] = [
    "---",
    `name: ${yamlScalar(page.name)}`,
    `description: ${yamlScalar(description)}`,
    "metadata:",
    `  type: ${yamlScalar(page.type)}`,
    `  kind: ${yamlScalar(page.kind)}`,
    `  origin: ${yamlScalar(pageOrigin(project, page.path))}`,
  ];
  if (page.fields.pinned === true) lines.push("  pinned: true");
  if (replacement !== undefined) lines.push("  status: superseded", `  superseded_by: ${yamlScalar(replacement)}`);
  return lines.concat("---", "").join("\n");
}

function renderPage(page: NamedPage, project: string, resolve: LinkResolver, issues: Issue[]): MigratedPage {
  const { name, kind, type, fields }: NamedPage = page;
  const title: string = oneLine(fields.title) ?? name;
  const description: string = descriptionFor(page);
  const replacement: string | undefined = replacementFor(page, resolve, issues);
  const superseded: boolean = replacement !== undefined;
  const frontmatter: string = emitFrontmatter(page, description, project, replacement);
  const body: string = page.body.replace(/\[\[([^[\]\r\n]+)\]\]/g, (match: string, reference: string): string => {
    const target: string | undefined = resolve(reference);
    return target === undefined ? match : `[[${target}]]`;
  });
  return { name, kind, type, title, description, superseded, content: frontmatter + body };
}

export function convertPages(
  sources: readonly WikiPage[],
  project: string,
  existingFiles: ReadonlySet<string>,
): ConvertedPages {
  const named: NamedPage[] = namePages(sources);
  const pending: NamedPage[] = named.filter(({ name }): boolean => !existingFiles.has(`${name}.md`));
  const existing: NamedPage[] = named.filter(({ name }): boolean => existingFiles.has(`${name}.md`));
  const resolve: LinkResolver = linkTargets(named, new Set(pending.map(({ name }): string => name)));
  const issues: Issue[] = [];
  const pages: MigratedPage[] = pending.map(
    (page: NamedPage): MigratedPage => renderPage(page, project, resolve, issues),
  );
  const skips: Skipped[] = existing.map(({ name }): Skipped => ({ target: `${name}.md`, reason: "already exists" }));
  return { pages, existing, skips, issues };
}
