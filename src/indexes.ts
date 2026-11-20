import { posix } from "node:path";
import type { MemoryFile } from "./frontmatter";
import { type Issue, receivedIssue } from "./issue";
import { markdownLines } from "./markdown";

const INDEX_LINE_LIMIT: number = 150;
const INDEX_BYTE_LIMIT: number = 25000;

export function validateIndexBudget(content: string, issues: Issue[]): number {
  const lines: number = markdownLines(content).length;
  const bytes: number = Buffer.byteLength(content, "utf8");
  if (lines > INDEX_LINE_LIMIT) {
    issues.push(receivedIssue("MEMORY.md", "line count", lines, `at most ${INDEX_LINE_LIMIT} lines`));
  }
  if (bytes > INDEX_BYTE_LIMIT) {
    issues.push(receivedIssue("MEMORY.md", "byte count", bytes, `at most ${INDEX_BYTE_LIMIT} UTF-8 bytes`));
  }
  return lines;
}

// Inserir marcador (formato, escopo) soma uma linha: num índice no teto, quebraria o orçamento que o check cobra.
export function overflowIssues(content: string): Issue[] {
  const issues: Issue[] = [];
  validateIndexBudget(content, issues);
  return issues;
}

export const OVERFLOW_HINT: string = "group entries into index-<dominio>.md first";

export function isDomainIndex(file: string): boolean {
  const isMarkdown: boolean = file.endsWith(".md");
  return isMarkdown && file.startsWith("index-");
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function relativeMarkdownTarget(href: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href)) return undefined;
  const path: string = decodePath(href.split(/[?#]/, 1)[0] ?? "");
  return path.endsWith(".md") ? posix.normalize(path) : undefined;
}

function validateLinksFrom(
  index: string,
  content: string,
  existingFiles: ReadonlySet<string>,
  supersededFiles: ReadonlySet<string>,
  linkedFiles: Set<string>,
  issues: Issue[],
): void {
  visitIndexTargets(content, (target: string, href: string): void => {
    linkedFiles.add(target);
    if (!existingFiles.has(target)) {
      issues.push(receivedIssue(index, "link target", href, "an existing Markdown file in the memory directory"));
    } else if (supersededFiles.has(target)) {
      issues.push(receivedIssue(index, "link target", href, 'a file without metadata.status "superseded"'));
    }
  });
}

export function visitIndexTargets(content: string, visit: (target: string, href: string) => void): void {
  Bun.markdown.render(content, {
    link(_children: string, { href }: Bun.markdown.LinkMeta): undefined {
      const target: string | undefined = relativeMarkdownTarget(href);
      if (target !== undefined) visit(target, href);
    },
  });
}

export function validateIndexLinks(
  indexes: ReadonlyMap<string, string>,
  existingFiles: ReadonlySet<string>,
  memories: readonly MemoryFile[],
  issues: Issue[],
): void {
  const supersededFiles: ReadonlySet<string> = new Set(
    memories
      .filter((memory: MemoryFile): boolean => memory.metadata.status === "superseded")
      .map((memory: MemoryFile): string => memory.file),
  );
  const linkedFiles: Set<string> = new Set();
  for (const [index, content] of indexes) {
    validateLinksFrom(index, content, existingFiles, supersededFiles, linkedFiles, issues);
  }
  for (const { file } of memories) {
    if (!supersededFiles.has(file) && !linkedFiles.has(file)) {
      issues.push(receivedIssue(file, "index link", undefined, "a link from MEMORY.md or index-*.md"));
    }
  }
}
