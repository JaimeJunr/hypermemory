import { formatIssue } from "../cli";
import { formatVersionIssue, MEMORY_INDEX, readFormat, scopeMarkerIssue } from "../format";
import type { Issue } from "../issue";
import type { MemoryReader } from "../validator";

export function readCurrentIndex(reader: MemoryReader, directory: string): string {
  const index: string = reader.list().includes(MEMORY_INDEX) ? reader.read(MEMORY_INDEX) : "";
  const issue: Issue | undefined = formatVersionIssue(readFormat(index), directory) ?? scopeMarkerIssue(index);
  if (issue !== undefined) throw new Error(formatIssue(issue));
  return index;
}
