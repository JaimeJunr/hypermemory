import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimedContent, renderHandoff } from "../mod/hooks/handoff-rules";
import { openDirectory, runCli } from "../src/cli";
import { markedIndex } from "./fixtures";

// A pasta pessoal ganha sessoes/<slug>/handoff-*.md do mod; o check não pode exigir linha de índice para eles.
function personalFolder(): string {
  const root: string = mkdtempSync(join(tmpdir(), "hm-sessoes-"));
  mkdirSync(join(root, "sessoes", "-repo"), { recursive: true });
  writeFileSync(join(root, "MEMORY.md"), markedIndex("<!-- hypermemory-scope: personal -->\n"));
  const open: string = renderHandoff({ name: "handoff-2026-11-20-abcdef12", description: "d", body: "corpo" });
  writeFileSync(join(root, "sessoes", "-repo", "handoff-2026-11-20-abcdef12.md"), open);
  writeFileSync(join(root, "sessoes", "-repo", "handoff-2026-11-19-11111111.md"), claimedContent(open, "2026-11-20 s"));
  return root;
}

test("a pasta pessoal com sessoes/<slug>/handoff-*.md passa no check, sem linha no índice", (): void => {
  const root: string = personalFolder();
  try {
    expect(runCli([root], openDirectory)).toEqual({
      exitCode: 0,
      output: ["ok: 0 memory files, MEMORY.md 2 lines, scope personal"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handoff gravado pelo mod em memória shared não acusa escopo, pois é type project", (): void => {
  const root: string = personalFolder();
  try {
    writeFileSync(join(root, "MEMORY.md"), markedIndex("<!-- hypermemory-scope: shared -->\n"));
    expect(runCli([root], openDirectory).exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
