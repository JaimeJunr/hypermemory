import { expect, test } from "bun:test";
import { checkPrRules } from "../scripts/check-pr-rules";

test("mudança em src, mod ou bin sem CHANGELOG reprova", (): void => {
  for (const file of ["src/aging.ts", "mod/hooks/session-flow.ts", "bin/hypermemory"]) {
    expect(checkPrRules([file])).toEqual([expect.stringContaining("CHANGELOG.md")]);
  }
});

test("com CHANGELOG no mesmo PR passa", (): void => {
  expect(checkPrRules(["src/aging.ts", "CHANGELOG.md"])).toEqual([]);
});

test("só teste, doc, CI ou modelo não exige CHANGELOG", (): void => {
  const files = [
    "test/a.test.ts",
    "mod/hooks/session.test.ts",
    "README.md",
    ".github/workflows/ci.yml",
    "modelos/x.md",
  ];
  expect(checkPrRules(files)).toEqual([]);
});

test("PR vazio passa", (): void => {
  expect(checkPrRules([])).toEqual([]);
});
