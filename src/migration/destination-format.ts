import { formatIssue } from "../cli";
import { formatVersionIssue, MEMORY_INDEX, readFormat } from "../format";
import type { Issue } from "../issue";
import type { MemoryReader } from "../validator";

export function assertCurrentDestination(reader: MemoryReader, directory: string): void {
  const index: string = reader.list().includes(MEMORY_INDEX) ? reader.read(MEMORY_INDEX) : "";
  const issue: Issue | undefined = formatVersionIssue(readFormat(index), directory);
  if (issue !== undefined) throw new Error(formatIssue(issue));
}
