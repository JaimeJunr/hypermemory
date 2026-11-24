import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgingInput } from "../src/aging";
import { loadDirectory, runAging } from "../src/aging-cli";

const NOW: Date = new Date("2026-11-24T12:00:00Z");
const OLD_PAGE: AgingInput = {
  file: "velha.md",
  content: '---\nname: velha\ndescription: "d"\nmetadata:\n  type: project\n---\n\nfato\n',
  mtime: new Date("2026-01-01T00:00:00Z"),
};

test("lista as memórias velhas e sai com 0: é aviso, não bloqueio", (): void => {
  const result = runAging(["pasta"], () => [OLD_PAGE], NOW);
  expect(result.exitCode).toBe(0);
  expect(result.output[0]).toBe("velha.md: sem toque desde 2026-01-01 (327 dias)");
});

test("--days muda o limite", (): void => {
  const result = runAging(["pasta", "--days", "400"], () => [OLD_PAGE], NOW);
  expect(result.output).toEqual(["ok: nenhuma memória sem toque há mais de 400 dias"]);
});

test("--days inválido e pasta ausente dão uso e saem com 1", (): void => {
  expect(runAging(["pasta", "--days", "abc"], () => [], NOW).exitCode).toBe(1);
  expect(runAging([], () => [], NOW).exitCode).toBe(1);
});

test("pasta ilegível sai com 1 e o motivo", (): void => {
  const result = runAging(
    ["x"],
    () => {
      throw new Error("ENOENT");
    },
    NOW,
  );
  expect(result.exitCode).toBe(1);
  expect(result.output[0]).toContain("ENOENT");
});

test("loadDirectory lê só os .md da pasta, com conteúdo e data do arquivo", (): void => {
  const dir: string = mkdtempSync(join(tmpdir(), "aging-"));
  try {
    writeFileSync(join(dir, "a.md"), "fato");
    writeFileSync(join(dir, "b.txt"), "ignorado");
    const loaded = loadDirectory(dir);
    expect(loaded.map((item) => [item.file, item.content])).toEqual([["a.md", "fato"]]);
    expect(loaded[0]?.mtime).toBeInstanceOf(Date);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
