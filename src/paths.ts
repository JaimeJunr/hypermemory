import { lstatSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fail, hasCode } from "./file-writes";

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

export function canonicalPath(path: string): string {
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

export function destinationPath(path: string): string {
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
