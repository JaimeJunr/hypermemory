import { MEMORY_KINDS, nonEmptyString } from "./frontmatter";
import { type Issue, receivedIssue } from "./issue";
import { markdownLines } from "./markdown";

const LOG_FILE: string = "LOG.md";
const LOG_KINDS: readonly string[] = [...MEMORY_KINDS, "event"];
const LOG_TEXT_LIMIT: number = 280;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date: Date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function checkLogLine(entry: string): Issue | undefined {
  if (entry.trim() === "" || entry.startsWith("<!--")) return undefined;
  const match: RegExpExecArray | null = /^([^|]+) \| ([^|]+) \| (.*)$/s.exec(entry);
  if (match === null) {
    return receivedIssue(LOG_FILE, "line format", entry, "YYYY-MM-DD | <kind> | <text>");
  }
  const [, date = "", kind = "", text = ""]: RegExpExecArray = match;
  if (!isRealDate(date)) {
    return receivedIssue(LOG_FILE, "date", date, "a real date in YYYY-MM-DD format");
  }
  if (!LOG_KINDS.includes(kind)) {
    return receivedIssue(LOG_FILE, "kind", kind, `one of ${LOG_KINDS.join("|")}`);
  }
  if (!nonEmptyString(text)) {
    return receivedIssue(LOG_FILE, "text", text, "a non-empty string");
  }
  const bytes: number = Buffer.byteLength(text, "utf8");
  return bytes > LOG_TEXT_LIMIT
    ? receivedIssue(LOG_FILE, "text byte count", bytes, `at most ${LOG_TEXT_LIMIT} UTF-8 bytes`)
    : undefined;
}

export function validateLogLines(content: string, issues: Issue[]): void {
  for (const [index, entry] of markdownLines(content).entries()) {
    const issue: Issue | undefined = checkLogLine(entry);
    if (issue !== undefined) issues.push({ ...issue, line: index + 1 });
  }
}

export function validateLogHistory(current: string, previous: string | undefined, issues: Issue[]): void {
  if (previous === undefined || current.startsWith(previous)) return;
  let offset: number = 0;
  while (current[offset] === previous[offset]) offset++;
  const expected: string = `${JSON.stringify(previous[offset])} from HEAD at UTF-16 offset ${offset}`;
  issues.push(receivedIssue(LOG_FILE, "append-only prefix", current[offset], expected));
}
