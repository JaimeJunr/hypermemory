import { validateIndexBudget, visitIndexTargets } from "../indexes";
import type { Issue } from "../issue";
import { appendLines } from "../markdown";
import type { Category } from "./wiki";

export interface IndexPage {
  readonly name: string;
  readonly kind: Category["kind"];
  readonly title: string;
  readonly description: string;
}

export interface IndexEdit {
  readonly file: string;
  readonly content: string;
  readonly lines: readonly string[];
}

const MAIN_INDEX: string = "MEMORY.md";

const MARKDOWN_ESCAPE: RegExp = /[\\\[\]<>&]/g;

const INDEX_TEXT_LIMIT: number = 80;

function indexText(value: string): string {
  const text: string = value.replaceAll("`", "").trim().replace(/\s+/gu, " ");
  const characters: string[] = [...text];
  if (characters.length <= INDEX_TEXT_LIMIT) return text;
  const prefix: string = characters.slice(0, INDEX_TEXT_LIMIT - 1).join("");
  const boundary: number = characters[INDEX_TEXT_LIMIT - 1] === " " ? prefix.length : prefix.lastIndexOf(" ");
  return (boundary > 0 ? prefix.slice(0, boundary) : prefix) + "…";
}

function indexLine(title: string, file: string, hook: string): string {
  const label: string = (indexText(title) || file.slice(0, -3)).replace(MARKDOWN_ESCAPE, "\\$&");
  const description: string = indexText(hook).replace(MARKDOWN_ESCAPE, "\\$&");
  return "- [" + label + "](" + file + ") — " + description;
}

function pageLine(page: IndexPage): string {
  const file: string = page.name + ".md";
  return indexLine(page.title, file, page.description);
}

function linkedFiles(indexes: ReadonlyMap<string, string>): Set<string> {
  const linked: Set<string> = new Set();
  for (const content of indexes.values()) {
    visitIndexTargets(content, (target: string): void => { linked.add(target); });
  }
  return linked;
}

function linkedIn(content: string): Set<string> {
  const linked: Set<string> = new Set();
  visitIndexTargets(content, (target: string): void => { linked.add(target); });
  return linked;
}

function fits(content: string): boolean {
  const issues: Issue[] = [];
  validateIndexBudget(content, issues);
  return issues.length === 0;
}

interface DomainGroup {
  readonly file: string;
  readonly kind: Category["kind"];
  readonly title: string;
  readonly existing: string;
  readonly pending: readonly IndexPage[];
  readonly linkedCount: number;
  readonly needsMainLink: boolean;
}

function domainGroup(
  indexes: ReadonlyMap<string, string>, kind: Category["kind"], pages: readonly IndexPage[], linked: ReadonlySet<string>,
): DomainGroup {
  const file: string = "index-" + kind + ".md";
  const title: string = kind.charAt(0).toUpperCase() + kind.slice(1);
  const heading: string = "# " + title + "\n";
  const existing: string = indexes.get(file) ?? heading;
  const domainTargets: ReadonlySet<string> = linkedIn(existing);
  const pending: IndexPage[] = pages.filter(({ name }): boolean => !linked.has(name + ".md"));
  const linkedCount: number = pages.filter(({ name }): boolean => domainTargets.has(name + ".md")).length;
  const needsMainLink: boolean = !linked.has(file) && (pending.length > 0 || linkedCount > 0 && existing.startsWith(heading));
  return { file, title, kind, existing, pending, linkedCount, needsMainLink };
}

function addDomain(domain: DomainGroup, edits: IndexEdit[], mainLines: string[]): void {
  const { file, kind, title, existing, pending, linkedCount }: DomainGroup = domain;
  const lines: string[] = pending.map(pageLine);
  if (lines.length > 0) edits.push({ file, content: appendLines(existing, lines), lines });
  if (domain.needsMainLink) {
    const hook: string = (pending.length + linkedCount) + " memórias de " + kind + " migradas do ai-memory";
    mainLines.push(indexLine(title, file, hook));
  }
}

function archiveName(indexes: ReadonlyMap<string, string>, current: string): string {
  const linked: ReadonlySet<string> = linkedFiles(indexes);
  for (const [file, content] of indexes) {
    if (/^index-existing(?:-\d+)?\.md$/.test(file) && content === current && !linked.has(file)) return file;
  }
  let file: string = "index-existing.md";
  for (let suffix: number = 2; indexes.has(file); suffix++) file = "index-existing-" + suffix + ".md";
  return file;
}

function finishMain(indexes: ReadonlyMap<string, string>, mainLines: string[], edits: IndexEdit[]): void {
  const previous: string = indexes.get(MAIN_INDEX) ?? "";
  const content: string = appendLines(previous, mainLines);
  if (fits(content)) {
    if (mainLines.length > 0) edits.push({ file: MAIN_INDEX, content, lines: mainLines });
    return;
  }
  // O índice anterior fica inteiro para preservar os links e suas definições.
  const archive: string = archiveName(indexes, previous);
  if (!indexes.has(archive)) edits.push({ file: archive, content: previous, lines: [] });
  mainLines.unshift(indexLine("Existing memories", archive, "Índice anterior"));
  edits.push({ file: MAIN_INDEX, content: appendLines("", mainLines), lines: mainLines });
}

function groupedIndexes(indexes: ReadonlyMap<string, string>, domains: readonly DomainGroup[]): IndexEdit[] {
  const edits: IndexEdit[] = [];
  const mainLines: string[] = [];
  for (const domain of domains) addDomain(domain, edits, mainLines);
  finishMain(indexes, mainLines, edits);
  return edits;
}

export function planIndexes(indexes: ReadonlyMap<string, string>, pages: readonly IndexPage[]): IndexEdit[] {
  const linked: ReadonlySet<string> = linkedFiles(indexes);
  const groups: ReadonlyMap<Category["kind"], IndexPage[]> = Map.groupBy(pages, (page: IndexPage): Category["kind"] => page.kind);
  const domains: DomainGroup[] = [...groups].map(([kind, entries]): DomainGroup => domainGroup(indexes, kind, entries, linked));
  if (domains.some((domain: DomainGroup): boolean => domain.needsMainLink && domain.linkedCount > 0)) {
    return groupedIndexes(indexes, domains);
  }
  const lines: string[] = pages.filter(({ name }): boolean => !linked.has(name + ".md")).map(pageLine);
  if (lines.length === 0) return [];
  const content: string = appendLines(indexes.get(MAIN_INDEX) ?? "", lines);
  return fits(content) ? [{ file: MAIN_INDEX, content, lines }] : groupedIndexes(indexes, domains);
}
