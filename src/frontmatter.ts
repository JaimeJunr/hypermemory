import { receivedIssue, type Issue } from "./issue";

const kindsByType: ReadonlyMap<string, readonly string[]> = new Map([
  ["user", ["profile"]],
  ["feedback", ["rule"]],
  ["project", ["decision", "gotcha", "procedure", "concept", "session"]],
  ["reference", ["reference"]],
]);

export const MEMORY_KINDS: readonly string[] = [...kindsByType.values()].flat();

export interface MemoryFile {
  readonly file: string;
  readonly name: unknown;
  readonly description?: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function isMapping(value: unknown): value is Readonly<Record<string, unknown>> {
  const isObject: boolean = typeof value === "object" && value !== null;
  return isObject && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
}

interface FrontmatterBlock {
  readonly yaml: string | undefined;
  readonly body: string;
}

export function splitFrontmatter(content: string): FrontmatterBlock {
  const block: RegExpExecArray | null = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)(?<=\n)---[ \t]*(?:\r?\n|$)/.exec(content);
  return block === null ? { yaml: undefined, body: content } : { yaml: block[1], body: content.slice(block[0].length) };
}

function readFrontmatter(content: string): unknown {
  const { yaml }: FrontmatterBlock = splitFrontmatter(content);
  return yaml === undefined ? undefined : Bun.YAML.parse(yaml);
}

function validateKind(file: string, metadata: Readonly<Record<string, unknown>>, issues: Issue[]): void {
  const { type, kind }: Readonly<Record<string, unknown>> = metadata;
  const allowedKinds: readonly string[] | undefined = typeof type === "string" ? kindsByType.get(type) : undefined;
  if (allowedKinds === undefined) {
    const allowedTypes: string = [...kindsByType.keys()].join("|");
    issues.push(receivedIssue(file, "metadata.type", type, "one of " + allowedTypes));
  } else if (kind !== undefined && (typeof kind !== "string" || !allowedKinds.includes(kind))) {
    const expected: string = "one of " + allowedKinds.join("|") + " for metadata.type " + JSON.stringify(type);
    issues.push(receivedIssue(file, "metadata.kind", kind, expected));
  }
}

function validateFields(file: string, frontmatter: Readonly<Record<string, unknown>>, issues: Issue[]): MemoryFile {
  const { name, description }: Readonly<Record<string, unknown>> = frontmatter;
  const metadata: Readonly<Record<string, unknown>> = isMapping(frontmatter.metadata) ? frontmatter.metadata : {};
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    issues.push(receivedIssue(file, "name", name, "kebab-case"));
  }
  if (!nonEmptyString(description)) {
    issues.push(receivedIssue(file, "description", description, "a non-empty string"));
  }
  validateKind(file, metadata, issues);
  return { file, name, description, metadata };
}

export function validateFrontmatter(file: string, content: string, issues: Issue[]): MemoryFile {
  let frontmatter: unknown;
  try {
    frontmatter = readFrontmatter(content);
  } catch {
    frontmatter = undefined;
  }
  if (!isMapping(frontmatter)) {
    issues.push(receivedIssue(file, "frontmatter", content, "a YAML mapping between --- delimiters at the start of the file"));
    return { file, name: undefined, metadata: {} };
  }
  return validateFields(file, frontmatter, issues);
}
