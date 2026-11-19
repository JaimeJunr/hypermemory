import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSize } from "../scripts/check-size";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "hypermemory-size-"));
  try {
    mkdirSync(join(root, "src", "nested"), { recursive: true });
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "src", "nested", "boundary.txt"), "line\r\n".repeat(300));
    writeFileSync(join(root, "test", "empty.txt"), "");
    writeFileSync(join(root, "README.md"), "line\n".repeat(301));
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("size accepts 300 lines, includes empty files, and ignores files outside src and test", () => {
  fixture((root) => {
    expect(checkSize(root)).toEqual({ checked: 2, violations: [] });
  });
});

test("size reports a nested file with 301 lines and no final newline", () => {
  fixture((root) => {
    writeFileSync(join(root, "src", "nested", "oversize.txt"), `${"line\n".repeat(300)}line`);
    expect(checkSize(root)).toEqual({
      checked: 3,
      violations: [`${join("src", "nested", "oversize.txt")}: received 301 lines, expected at most 300`],
    });
  });
});
