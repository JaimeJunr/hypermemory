// Regras de PR que o revisor esquece: código que muda o comportamento do produto entra no CHANGELOG.
const PRODUCT_CODE: RegExp = /^(src\/|mod\/|bin\/)/;
const TEST_FILE: RegExp = /\.test\.[mc]?[jt]s$/;

export function checkPrRules(changedFiles: readonly string[]): string[] {
  const touchesProduct: boolean = changedFiles.some(
    (file: string): boolean => PRODUCT_CODE.test(file) && !TEST_FILE.test(file),
  );
  if (touchesProduct && !changedFiles.includes("CHANGELOG.md")) {
    return ["src/, mod/ ou bin/ mudou sem CHANGELOG.md: registre a mudança em [Unreleased]."];
  }
  return [];
}
