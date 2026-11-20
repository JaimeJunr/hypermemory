import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryMemoryReader } from "../src/readers";

test("nested lists .md files in subfolders, skipping top-level files and hidden folders", (): void => {
  const root: string = mkdtempSync(join(tmpdir(), "hm-nested-"));
  try {
    for (const folder of ["archive/old", ".git"]) mkdirSync(join(root, folder), { recursive: true });
    for (const file of ["top.md", "archive/a.md", "archive/notes.txt", "archive/old/b.md", ".git/c.md"]) {
      writeFileSync(join(root, file), "x");
    }
    const reader: DirectoryMemoryReader = new DirectoryMemoryReader(root);
    expect([...reader.nested()].sort()).toEqual(["archive/a.md", "archive/old/b.md"]);
    expect(reader.list()).toEqual(["top.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
