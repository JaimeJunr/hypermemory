// Mutantes escritos à mão: cada um quebra uma regra de propósito e a suíte tem de ficar vermelha.
// Mutante novo nasce junto com a regra; troca que deixa de casar com o código reprova (mutante velho).
import type { Mutant } from "./mutate";

const m = (file: string, from: string, to: string, label: string): Mutant => ({ file, from, to, label });

export const MUTANTS: readonly Mutant[] = [
  m("src/aging.ts", "age > days", "age >= days", "aging: limite exclusivo vira inclusivo"),
  m("src/aging.ts", "metadata.pinned === true", "metadata.pinned === false", "aging: pinned deixa de isentar"),
  m("src/aging.ts", 'metadata.kind === "session"', 'metadata.kind === "nada"', "aging: handoff deixa de ser isento"),
  m("src/aging.ts", ".at(-1)", ".at(0)", "aging: pega a data mais antiga"),
  m("src/aging.ts", "b.ageDays - a.ageDays", "a.ageDays - b.ageDays", "aging: ordem invertida"),
  m("mod/hooks/capture-rules.ts", ".slice(0, MAX_CANDIDATES)", "", "capture: sem teto de candidatos"),
  m("mod/hooks/capture-rules.ts", "<= MAX_TEXT_BYTES", "< MAX_TEXT_BYTES", "capture: limite de bytes exclusivo"),
  m("mod/hooks/capture-rules.ts", "    !SECRET.test(text);", "    true;", "capture: filtro de segredo removido"),
  m("mod/hooks/capture-rules.ts", "KINDS.includes(kind) &&", "true &&", "capture: kind desconhecido aceito"),
  m(
    "mod/hooks/session-flow.ts",
    '[rewritten ?? parsed.body, candidates].filter(Boolean).join("\\n\\n")',
    "rewritten ?? parsed.body",
    "flow: candidatos fora do resumo",
  ),
  m("src/indexes.ts", "INDEX_LINE_LIMIT: number = 150", "INDEX_LINE_LIMIT: number = 151", "indexes: teto de linhas"),
  m("src/indexes.ts", "INDEX_BYTE_LIMIT: number = 25000", "INDEX_BYTE_LIMIT: number = 25001", "indexes: teto de bytes"),
];
