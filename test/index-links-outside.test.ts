import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDirectory, runCli } from "../src/cli";
import { check, markedIndex, memory } from "./fixtures";

// Repo de contexto liga o índice da memória a arquivos/, repos/ e CLAUDE.md, fora de memory/.
test("a link out of the memory directory passes when the file exists in the repository", (): void => {
  expect(
    check({
      "MEMORY.md": "[Decisão](../arquivos/decisao-0001.md) e [Regras](../CLAUDE.md#git)",
      "../arquivos/decisao-0001.md": "# Decisão\n",
      "../CLAUDE.md": "# Regras\n",
    }).issues,
  ).toEqual([]);
});

test("a link out of the memory directory to a missing file is reported", (): void => {
  expect(check({ "index-work.md": "[Perdido](../arquivos/sumiu.md)" }).issues).toEqual([
    {
      file: "index-work.md",
      message:
        'link target: received "../arquivos/sumiu.md", expected an existing Markdown file next to the memory directory',
    },
  ]);
});

test("a file outside the memory directory is neither a memory nor needs an index link", (): void => {
  const result = check({
    "MEMORY.md": "[Fato](fato.md)",
    "fato.md": memory("fato"),
    "../arquivos/solto.md": "sem frontmatter\n",
  });
  expect(result.issues).toEqual([]);
  expect(result.memoryFiles).toBe(1);
});

test("the disk reader resolves links out of the memory directory against the real repository", (): void => {
  const root: string = mkdtempSync(join(tmpdir(), "hm-outside-"));
  try {
    mkdirSync(join(root, "memory"));
    mkdirSync(join(root, "arquivos"));
    writeFileSync(join(root, "arquivos", "existe.md"), "# Existe\n");
    writeFileSync(
      join(root, "memory", "MEMORY.md"),
      markedIndex("[Existe](../arquivos/existe.md) [Falta](../arquivos/falta.md)\n"),
    );
    const output: readonly string[] = runCli([join(root, "memory")], openDirectory).output;
    expect(output.filter((line: string): boolean => line.includes("link target"))).toEqual([
      'MEMORY.md: link target: received "../arquivos/falta.md", expected an existing Markdown file next to the memory directory',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
