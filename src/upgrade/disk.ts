import { cpSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type MemorySources, openDirectory } from "../cli";
import type { FileChange } from "../file-changes";
import { fail, stageAndWrite, verifyChange, withWriteLock } from "../file-writes";
import { MEMORY_INDEX } from "../format";
import type { UpgradeDestination, UpgradeIO } from "../upgrade";

function backupDirectory(directory: string, backup: string): void {
  mkdirSync(backup, { mode: 0o700 });
  try {
    cpSync(directory, backup, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  } catch (error: unknown) {
    rmSync(backup, { recursive: true });
    throw error;
  }
}

class DiskUpgradeDestination implements UpgradeDestination {
  readonly reader: MemorySources["reader"];
  readonly previousLog: MemorySources["previousLog"];

  constructor(readonly directory: string) {
    const sources: MemorySources = openDirectory(directory);
    this.reader = sources.reader;
    this.previousLog = sources.previousLog;
  }

  withWriteLock<T>(work: () => T): T {
    return withWriteLock(this.directory, work);
  }

  backup(path: string): void {
    backupDirectory(this.directory, path);
  }

  write(changes: readonly FileChange[]): void {
    for (const change of changes) verifyChange(join(this.directory, change.file), change);
    // O marcador avança só depois de gravar os arquivos que a nova versão pressupõe.
    const ordered: FileChange[] = [...changes].sort(
      (a: FileChange, b: FileChange): number => Number(a.file === MEMORY_INDEX) - Number(b.file === MEMORY_INDEX),
    );
    for (const change of ordered) {
      const path: string = join(this.directory, change.file);
      stageAndWrite(path, change, verifyChange(path, change));
    }
  }
}

export class DiskUpgradeIO implements UpgradeIO {
  constructor(private readonly clock: () => Date = (): Date => new Date()) {}

  open(directory: string): UpgradeDestination {
    const resolved: string = realpathSync(directory);
    if (dirname(resolved) === resolved) fail(directory, "directory", directory, "a memory directory with a parent");
    return new DiskUpgradeDestination(resolved);
  }

  now(): Date {
    return this.clock();
  }
}
