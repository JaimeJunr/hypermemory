import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { openDirectory, runCli } from "../src/cli";
import { DiskInitIO, runInit } from "../src/init";
import { runMigration } from "../src/migrate";
import { DiskMigrationIO } from "../src/migration/disk";
import { runUpgrade } from "../src/upgrade";
import { DiskUpgradeIO } from "../src/upgrade/disk";

// Invariante: todo comando que grava a memória termina num diretório dentro do orçamento do índice
// (150 linhas, 25 mil bytes) ou recusa sem gravar. Os achados do Codex nos PRs #2 e #3 quebravam isso no teto.
const LINE_LIMIT: number = 150;
const BYTE_LIMIT: number = 25_000;

interface ExistingIndex {
  readonly lines: number;
  readonly padding: number;
  readonly header: "none" | "format" | "scoped";
  readonly newline: "\n" | "\r\n";
}

type Command = "init" | "upgrade" | "migrate";

const HEADERS: Record<ExistingIndex["header"], readonly string[]> = {
  none: [],
  format: ["<!-- hypermemory-format: 1 -->"],
  scoped: ["<!-- hypermemory-format: 1 -->", "<!-- hypermemory-scope: shared -->"],
};

function render({ lines, padding, header, newline }: ExistingIndex): string {
  const entries: string[] = Array.from(
    { length: lines },
    (_, i: number): string => `- [F${i}](f${i}.md) — ${"x".repeat(padding)}`,
  );
  return [...HEADERS[header], ...entries].join(newline);
}

function withinBudget(index: string): boolean {
  return index.split(/\r?\n/).length <= LINE_LIMIT && Buffer.byteLength(index, "utf8") <= BYTE_LIMIT;
}

const existingIndex: fc.Arbitrary<string> = fc
  .record({
    lines: fc.integer({ min: 0, max: LINE_LIMIT }),
    padding: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 150, max: 200 })),
    header: fc.constantFrom<ExistingIndex["header"]>("none", "format", "scoped"),
    newline: fc.constantFrom<ExistingIndex["newline"]>("\n", "\r\n"),
  })
  .map(render)
  .filter(withinBudget);

function snapshot(directory: string): Map<string, string> {
  const files: Map<string, string> = new Map();
  for (const name of readdirSync(directory)) {
    const path: string = join(directory, name);
    if (statSync(path).isFile()) files.set(name, readFileSync(path, "utf8"));
  }
  return files;
}

function wiki(root: string, pages: number): string {
  const project: string = join(root, "wiki", "ws", "pr");
  mkdirSync(join(project, "decisions"), { recursive: true });
  writeFileSync(join(root, "wiki", "ws", "_meta.md"), "workspace: ws\n");
  writeFileSync(join(project, "_meta.md"), "---\nproject: demo\n---\n");
  for (let i: number = 0; i < pages; i++) {
    writeFileSync(join(project, "decisions", `d${i}.md`), `---\ntitle: Decision ${i}\n---\nDecided ${i}.\n`);
  }
  return join(root, "wiki");
}

function run(command: Command, root: string, memory: string, pages: number): number {
  if (command === "init") return runInit([memory, "--scope", "shared", "--apply"], new DiskInitIO()).exitCode;
  if (command === "upgrade") return runUpgrade([memory, "--apply"], new DiskUpgradeIO()).exitCode;
  const from: string = wiki(root, pages);
  const args: string[] = ["ai-memory", "--from", from, "--project", "demo", "--apply", memory];
  return runMigration(args, new DiskMigrationIO()).exitCode;
}

function budgetIssues(memory: string): string[] {
  const output: readonly string[] = runCli([memory], openDirectory).output;
  return output.filter((line: string): boolean => /: (line|byte) count:/.test(line));
}

function holds(command: Command, index: string, pages: number): void {
  const root: string = mkdtempSync(join(tmpdir(), "hm-invariant-"));
  try {
    const memory: string = join(root, "memory");
    mkdirSync(memory);
    writeFileSync(join(memory, "MEMORY.md"), index);
    const before: Map<string, string> = snapshot(memory);
    if (run(command, root, memory, pages) !== 0 && budgetIssues(memory).length > 0) {
      expect(snapshot(memory)).toEqual(before);
      return;
    }
    expect(budgetIssues(memory)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const command of ["init", "upgrade", "migrate"] as const) {
  test(`${command} ends within the index budget or refuses without writing`, (): void => {
    const pages: fc.Arbitrary<number> = fc.integer({ min: 0, max: 3 });
    fc.assert(
      fc.property(existingIndex, pages, (index: string, count: number): void => holds(command, index, count)),
      { numRuns: 40, examples: [[render({ lines: 149, padding: 0, header: "format", newline: "\n" }), 1]] },
    );
  });
}
