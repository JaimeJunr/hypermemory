import {
  appendFileSync,
  closeSync,
  constants,
  type Dirent,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fail, hasCode, stageAndWrite, verifyChange, withWriteLock } from "../file-writes";
import type { MigrationDestination, MigrationIO, MigrationSource } from "../migrate";
import { canonicalPath, destinationPath } from "../paths";
import { DirectoryMemoryReader, GitPreviousLogReader, ProcessGitRunner } from "../readers";
import { readSkeleton, type Skeleton } from "../skeleton";
import { readCurrentIndex } from "./destination-format";
import type { FileChange } from "./plan";
import type { WikiEntry } from "./wiki";

const LOG_FILE: string = "LOG.md";

class DirectorySource implements MigrationSource {
  entries(directory: string): WikiEntry[] | undefined {
    try {
      const entries: Dirent[] = readdirSync(directory, { withFileTypes: true });
      return entries
        .filter((entry: Dirent): boolean => entry.isDirectory() || entry.isFile())
        .map((entry: Dirent): WikiEntry => ({ name: entry.name, directory: entry.isDirectory() }));
    } catch (error: unknown) {
      if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return undefined;
      throw error;
    }
  }

  read(file: string): string {
    const content: string = readFileSync(file, "utf8");
    return content;
  }

  bytes(file: string): Uint8Array {
    const bytes: Buffer = readFileSync(file);
    return bytes;
  }
}

class OptionalDirectoryReader extends DirectoryMemoryReader {
  override list(): string[] {
    try {
      return super.list();
    } catch (error: unknown) {
      if (hasCode(error, "ENOENT")) return [];
      throw error;
    }
  }
}

function ensureOutsideSource(directory: string, source: string): void {
  const path: string = relative(canonicalPath(source), canonicalPath(directory));
  if (path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))) {
    fail(directory, "destination", directory, "a destination outside the source directory");
  }
}

function appendLog(path: string, before: string, content: string): void {
  const fd: number = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const stat: Stats = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) fail(path, "log", path, "a regular unshared file");
    if (readFileSync(fd, "utf8") !== before || !content.startsWith(before)) {
      fail(path, "log state", "changed contents or an invalid append", "the same log contents as during planning");
    }
    appendFileSync(fd, content.slice(before.length), "utf8");
  } finally {
    closeSync(fd);
  }
}

function writeChange(directory: string, change: FileChange): void {
  const path: string = join(directory, change.file);
  const stat: Stats | undefined = verifyChange(path, change);
  if (change.file === LOG_FILE && change.before !== undefined) appendLog(path, change.before, change.content);
  else stageAndWrite(path, change, stat);
}

class DirectoryDestination implements MigrationDestination {
  readonly reader: DirectoryMemoryReader;
  readonly previousLog: GitPreviousLogReader;
  readonly directory: string;

  constructor(
    directory: string,
    private readonly source: string,
  ) {
    this.directory = destinationPath(directory);
    ensureOutsideSource(this.directory, source);
    this.reader = new OptionalDirectoryReader(this.directory);
    this.previousLog = new GitPreviousLogReader(this.directory, new ProcessGitRunner());
  }

  exists(): boolean {
    return lstatSync(this.directory, { throwIfNoEntry: false }) !== undefined;
  }

  apply(changes: readonly FileChange[], expectedIndex: string | undefined): void {
    ensureOutsideSource(this.directory, this.source);
    mkdirSync(dirname(this.directory), { recursive: true });
    withWriteLock(this.directory, (): void => {
      const index: string | undefined = this.exists() ? readCurrentIndex(this.reader, this.directory) : undefined;
      if (index !== expectedIndex) {
        fail(this.directory, "index state", "changed MEMORY.md", "the same index contents as during planning");
      }
      for (const change of changes) verifyChange(join(this.directory, change.file), change);
      mkdirSync(this.directory, { recursive: true });
      for (const change of changes) writeChange(this.directory, change);
    });
  }
}

export class DiskMigrationIO implements MigrationIO {
  readonly home: string = homedir();
  readonly memoryDir: string | undefined = process.env.MEMORY_DIR;
  readonly source: MigrationSource = new DirectorySource();

  get skeleton(): Skeleton {
    return readSkeleton();
  }

  destination(directory: string, source: string): MigrationDestination {
    const destination: DirectoryDestination = new DirectoryDestination(directory, source);
    return destination;
  }
}
