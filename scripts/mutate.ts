// Teste de mutação enxuto: aplica cada mutante, roda a suíte e exige que ela falhe. A lógica fica aqui,
// testável em processo; a linha de comando está em mutate-cli.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Mutant {
  readonly file: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface MutationResult {
  readonly killed: readonly Mutant[];
  readonly survived: readonly Mutant[];
}

export function selectMutants(mutants: readonly Mutant[], changed: readonly string[] | "all"): Mutant[] {
  return mutants.filter((mutant: Mutant): boolean => changed === "all" || changed.includes(mutant.file));
}

export function applyMutant(source: string, mutant: Mutant): string {
  if (!source.includes(mutant.from)) {
    throw new Error(`mutante velho em ${mutant.file}: o trecho ${JSON.stringify(mutant.from)} não existe mais`);
  }
  return source.replace(mutant.from, () => mutant.to);
}

// O arquivo volta ao original mesmo se a suíte lançar: nunca deixa o repositório mutado.
export function runMutants(mutants: readonly Mutant[], root: string, suitePasses: () => boolean): MutationResult {
  const killed: Mutant[] = [];
  const survived: Mutant[] = [];
  for (const mutant of mutants) {
    const path: string = join(root, mutant.file);
    const original: string = readFileSync(path, "utf8");
    try {
      writeFileSync(path, applyMutant(original, mutant));
      (suitePasses() ? survived : killed).push(mutant);
    } finally {
      writeFileSync(path, original);
    }
  }
  return { killed, survived };
}
