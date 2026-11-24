import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutant, type Mutant, runMutants, selectMutants } from "../scripts/mutate";

const M = (file: string, from = "a > b", to = "a >= b"): Mutant => ({ file, from, to, label: `${file}: ${from}` });

test("selectMutants pega só os mutantes dos arquivos alterados", (): void => {
  const mutants = [M("src/a.ts"), M("src/b.ts")];
  expect(selectMutants(mutants, ["src/b.ts", "README.md"])).toEqual(mutants.slice(1));
  expect(selectMutants(mutants, "all")).toEqual(mutants);
});

test("applyMutant troca a primeira ocorrência e recusa troca que não casa mais", (): void => {
  expect(applyMutant("if (a > b) a > b", M("x"))).toBe("if (a >= b) a > b");
  expect(() => applyMutant("nada aqui", M("x"))).toThrow("mutante velho");
});

test("runMutants separa mortos de sobreviventes e sempre restaura o arquivo", (): void => {
  const dir = mkdtempSync(join(tmpdir(), "mutate-"));
  try {
    writeFileSync(join(dir, "a.ts"), "ok a > b");
    writeFileSync(join(dir, "b.ts"), "ok a > b");
    const seen: string[] = [];
    // O "teste" falha (mata o mutante) só para a.ts; para b.ts a suíte continua verde.
    const suitePasses = (): boolean => {
      seen.push(readFileSync(join(dir, "a.ts"), "utf8"));
      return !readFileSync(join(dir, "a.ts"), "utf8").includes(">=");
    };
    const result = runMutants([M("a.ts"), M("b.ts")], dir, suitePasses);
    expect(result.killed.map((m) => m.file)).toEqual(["a.ts"]);
    expect(result.survived.map((m) => m.file)).toEqual(["b.ts"]);
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("ok a > b");
    expect(readFileSync(join(dir, "b.ts"), "utf8")).toBe("ok a > b");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("runMutants restaura o arquivo mesmo quando a suíte lança", (): void => {
  const dir = mkdtempSync(join(tmpdir(), "mutate-"));
  try {
    writeFileSync(join(dir, "a.ts"), "ok a > b");
    expect(() =>
      runMutants([M("a.ts")], dir, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe("ok a > b");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
