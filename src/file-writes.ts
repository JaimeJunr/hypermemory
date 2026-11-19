import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { formatIssue } from "./cli";
import type { FileChange } from "./file-changes";
import { receivedIssue } from "./issue";

export function hasCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "code" in error && error.code === code;
}

export function fail(file: string, field: string, value: unknown, expected: string): never {
  const message: string = formatIssue(receivedIssue(file, field, value, expected));
  throw new Error(message);
}

export function verifyChange(path: string, change: FileChange): Stats | undefined {
  const stat: Stats | undefined = lstatSync(path, { throwIfNoEntry: false });
  if (stat !== undefined && (!stat.isFile() || stat.nlink !== 1)) {
    fail(path, "file", path, "a regular unshared file");
  }
  const content: string | undefined = stat === undefined ? undefined : readFileSync(path, "utf8");
  if (content !== change.before) {
    fail(
      path,
      "file state",
      content === undefined ? "missing" : "present with different contents",
      "the same file state as during planning",
    );
  }
  return stat;
}

export function stageAndWrite(path: string, change: FileChange, stat: Stats | undefined): void {
  const temporary: string = join(dirname(path), `.hypermemory-${randomUUID()}.tmp`);
  const fd: number = openSync(temporary, "wx", stat === undefined ? undefined : stat.mode & 0o777);
  try {
    try {
      writeFileSync(fd, change.content, "utf8");
    } finally {
      closeSync(fd);
    }
    verifyChange(path, change);
    if (stat === undefined) linkSync(temporary, path);
    else renameSync(temporary, path);
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false }) !== undefined) unlinkSync(temporary);
  }
}

export function withWriteLock<T>(directory: string, work: () => T): T {
  const lock: string = `${directory}.hypermemory-write.lock`;
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error: unknown) {
    if (hasCode(error, "EEXIST")) fail(lock, "write lock", "present", "an unlocked destination");
    throw error;
  }
  try {
    return work();
  } finally {
    rmdirSync(lock);
  }
}
