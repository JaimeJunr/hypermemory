import { receivedIssue, type Issue } from "../issue";
import { checkLogLine } from "../log";

export interface OptMemRecords {
  readonly lines: readonly string[];
  readonly skipped: number;
  readonly issues: readonly Issue[];
}

const RECORD_BYTES: number = 320;
const UTF8: TextDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function recordIssue(index: number, raw: string, expected: string): Issue {
  const field: string = "record #" + index;
  return receivedIssue("LOG.txt", field, raw, expected);
}

function convertRecord(bytes: Uint8Array, index: number): string | Issue | undefined {
  const raw: string = Buffer.from(bytes).toString("utf8").replace(/[ \r\n\x00]+$/, "");
  if (bytes.length !== RECORD_BYTES) return recordIssue(index, raw, "exactly 320 bytes, received " + bytes.length + " bytes");
  try {
    UTF8.decode(bytes);
  } catch {
    return recordIssue(index, raw, "valid UTF-8");
  }
  if (raw === "") return undefined;
  const match: RegExpExecArray | null = /^#\d+ (\d{4}-\d{2}-\d{2}) ([^\r\n\x00]+)$/.exec(raw);
  if (match === null) return recordIssue(index, raw, "#<index> <YYYY-MM-DD> <text> on one line");
  const line: string = match[1] + " | event | " + match[2];
  const issue: Issue | undefined = checkLogLine(line);
  return issue === undefined ? line : recordIssue(index, raw, issue.message.split(", expected ").at(-1) ?? "a valid LOG.md line");
}

export function readOptMemRecords(bytes: Uint8Array): OptMemRecords {
  const lines: string[] = [];
  const issues: Issue[] = [];
  let skipped: number = 0;
  for (let offset: number = 0; offset < bytes.length; offset += RECORD_BYTES) {
    const record: string | Issue | undefined = convertRecord(bytes.subarray(offset, offset + RECORD_BYTES), offset / RECORD_BYTES);
    if (record === undefined) skipped++;
    else if (typeof record === "string") lines.push(record);
    else issues.push(record);
  }
  return { lines, skipped, issues };
}
