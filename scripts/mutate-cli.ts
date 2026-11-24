// Uso: bun run mutate --all | --base <sha> | --list. Só os arquivos alterados pelo PR entram com --base.
import { type Mutant, runMutants, selectMutants } from "./mutate";

function changedFiles(base: string): string[] {
  const diff = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`]);
  if (diff.exitCode !== 0) throw new Error(`git diff failed: ${diff.stderr.toString("utf8")}`);
  return diff.stdout.toString("utf8").split("\n").filter(Boolean);
}

function suitePasses(): boolean {
  return Bun.spawnSync(["bun", "test"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

if (import.meta.main) {
  const { MUTANTS } = await import("./mutants");
  const args: string[] = Bun.argv.slice(2);
  const baseAt: number = args.indexOf("--base");
  const base: string | undefined = baseAt >= 0 ? args[baseAt + 1] : undefined;
  if (!args.includes("--all") && !args.includes("--list") && (base === undefined || base === "")) {
    console.log("usage: bun run mutate --all | --base <sha> | --list");
    process.exit(1);
  }
  const everything: boolean = args.includes("--all") || (base === undefined && args.includes("--list"));
  const selected: Mutant[] = selectMutants(MUTANTS, everything ? "all" : changedFiles(base ?? ""));
  if (args.includes("--list")) {
    for (const mutant of selected) console.log(`${mutant.file}: ${mutant.label}`);
  } else if (selected.length === 0) {
    console.log("ok: nenhum arquivo alterado tem mutante em scripts/mutants.ts");
  } else {
    const { killed, survived } = runMutants(selected, process.cwd(), suitePasses);
    for (const mutant of killed) console.log(`morto       ${mutant.label}`);
    for (const mutant of survived) console.log(`SOBREVIVEU  ${mutant.label}`);
    process.exitCode = survived.length === 0 ? 0 : 1;
  }
}
