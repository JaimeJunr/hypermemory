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
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, hasCode, stageAndWrite, verifyChange, withWriteLock } from "../file-writes";
import type { MigrationDestination, MigrationIO, MigrationSource } from "../migrate";
import { DirectoryMemoryReader, GitPreviousLogReader, ProcessGitRunner } from "../readers";
import { assertCurrentDestination } from "./destination-format";
import type { FileChange, Skeleton } from "./plan";
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

function canonicalPath(path: string): string {
  const absolute: string = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error: unknown) {
    if (!hasCode(error, "ENOENT")) throw error;
    const parent: string = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalPath(parent), basename(absolute));
  }
}

function destinationPath(path: string): string {
  try {
    const canonical: string = canonicalPath(path);
    const stat: Stats | undefined = lstatSync(canonical, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isDirectory()) fail(path, "destination", path, "a destination directory");
    return canonical;
  } catch (error: unknown) {
    if (hasCode(error, "ENOTDIR")) fail(path, "destination", path, "a destination directory");
    throw error;
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
  private readonly directory: string;

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

  apply(changes: readonly FileChange[]): void {
    ensureOutsideSource(this.directory, this.source);
    mkdirSync(dirname(this.directory), { recursive: true });
    withWriteLock(this.directory, (): void => {
      if (this.exists()) assertCurrentDestination(this.reader, this.directory);
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
    const directory: string = fileURLToPath(new URL("../../memory/", import.meta.url));
    return { memory: this.source.read(join(directory, "MEMORY.md")), log: this.source.read(join(directory, "LOG.md")) };
  }

  destination(directory: string, source: string): MigrationDestination {
    const destination: DirectoryDestination = new DirectoryDestination(directory, source);
    return destination;
  }
}
