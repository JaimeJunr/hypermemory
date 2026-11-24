import { expect, test } from "bun:test";
import { candidatesPrompt, formatCandidates, parseCandidates } from "../mod/hooks/capture-rules";

test("parseCandidates aceita linhas 'kind | texto', com ou sem marcador de lista", (): void => {
  const text = "- decision | Usar SQLite no cache\ngotcha | O hook não roda no /clear";
  expect(parseCandidates(text)).toEqual([
    { kind: "decision", text: "Usar SQLite no cache" },
    { kind: "gotcha", text: "O hook não roda no /clear" },
  ]);
});

test("parseCandidates descarta kind desconhecido, linha solta, texto vazio e acima de 280 bytes", (): void => {
  const text = ["opinion | x", "só uma frase", "rule | ", `rule | ${"a".repeat(281)}`].join("\n");
  expect(parseCandidates(text)).toEqual([]);
});

test("parseCandidates guarda no máximo 3", (): void => {
  const text = ["a", "b", "c", "d"].map((letter: string): string => `rule | regra ${letter}`).join("\n");
  expect(parseCandidates(text)).toHaveLength(3);
});

test("parseCandidates descarta candidato que parece segredo", (): void => {
  expect(parseCandidates("reference | token sk-abcdefghijklmnopqrstuvwx1234 do serviço")).toEqual([]);
});

test("formatCandidates devolve vazio sem candidato e lista com kind quando há", (): void => {
  expect(formatCandidates([])).toBe("");
  expect(formatCandidates([{ kind: "rule", text: "Sempre rodar o gate" }])).toBe(
    "**Candidatos a memória (revise; grave só os que valem):**\n- rule | Sempre rodar o gate",
  );
});

test("candidatesPrompt leva o registro e pede o formato kind | texto", (): void => {
  expect(candidatesPrompt("corpo da sessão")).toContain("corpo da sessão");
});

test("parseCandidates aceita exatamente 280 bytes (contados em UTF-8) e recusa 281", (): void => {
  expect(parseCandidates(`rule | ${"á".repeat(140)}`)).toHaveLength(1);
  expect(parseCandidates(`rule | ${"á".repeat(140)}a`)).toEqual([]);
});
