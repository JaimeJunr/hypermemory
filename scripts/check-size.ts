import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const MAX_LINES = 300;

function* filesUnder(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(file);
    else if (entry.isFile()) yield file;
  }
}

function countLines(content: string): number {
  if (content === "") return 0;
  const lines = content.split(/\r\n|\n|\r/);
  return lines.length - Number(lines.at(-1) === "");
}

export function checkSize(root: string): { checked: number; violations: string[] } {
  const files = ["src", "test"].flatMap((directory) => [...filesUnder(join(root, directory))]).sort();
  const violations: string[] = [];
  for (const file of files) {
    const lines = countLines(readFileSync(file, "utf8"));
    if (lines > MAX_LINES) {
      const path = relative(root, file);
      violations.push(`${path}: received ${lines} lines, expected at most ${MAX_LINES}`);
    }
  }
  return { checked: files.length, violations };
}

if (import.meta.main) {
  const { checked, violations } = checkSize(process.cwd());
  for (const violation of violations) console.error(violation);
  console.log(`Size checked ${checked} files in src/ and test/. ${violations.length} violations.`);
  process.exitCode = Number(violations.length > 0);
}
