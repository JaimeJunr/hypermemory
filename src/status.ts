import { type MemoryFile, nonEmptyString } from "./frontmatter";
import { type Issue, receivedIssue } from "./issue";

export function validateSupersedes(memories: readonly MemoryFile[], issues: Issue[]): void {
  for (const { file, metadata } of memories) {
    if (metadata.status !== "superseded") continue;
    const replacement: unknown = metadata.superseded_by;
    const hasReplacement: boolean =
      typeof replacement === "string" &&
      memories.some((other: MemoryFile): boolean => other.file !== file && other.name === replacement);
    if (!hasReplacement) {
      issues.push(
        receivedIssue(file, "metadata.superseded_by", replacement, "the name of another existing memory file"),
      );
    }
  }
}

const SESSION_STATUSES: readonly string[] = ["open", "claimed", "superseded"];

export function validateHandoffs(memories: readonly MemoryFile[], issues: Issue[]): void {
  for (const { file, metadata } of memories) {
    const { kind, status, claimed_by: claimedBy }: Readonly<Record<string, unknown>> = metadata;
    if (kind !== "session") continue;
    if (typeof status !== "string" || !SESSION_STATUSES.includes(status)) {
      const expected: string = `one of ${SESSION_STATUSES.join("|")} for metadata.kind session`;
      issues.push(receivedIssue(file, "metadata.status", status, expected));
    } else if (status === "claimed" && !nonEmptyString(claimedBy)) {
      issues.push(receivedIssue(file, "metadata.claimed_by", claimedBy, "a non-empty string"));
    }
  }
}
