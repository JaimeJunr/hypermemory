export interface FileChange {
  readonly file: string;
  readonly before: string | undefined;
  readonly content: string;
}

export function changedFiles(old: ReadonlyMap<string, string>, updated: ReadonlyMap<string, string>): FileChange[] {
  const changes: FileChange[] = [];
  for (const [file, content] of updated) {
    const before: string | undefined = old.get(file);
    if (before !== content) changes.push({ file, before, content });
  }
  return changes;
}
