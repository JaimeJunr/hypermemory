// Captura de candidatos a memória a partir do registro da sessão. Regras puras, sem API do Claude Code:
// o session-flow.ts as usa por trás de SessionIo. O modelo só sugere; nada é gravado na memória do projeto
// (repo de time é versionado): os candidatos vão no resumo da próxima sessão e o agente decide o que promover.

export const MAX_CANDIDATES: number = 3;
const MAX_TEXT_BYTES: number = 280;
const KINDS: readonly string[] = ["profile", "rule", "decision", "gotcha", "procedure", "concept", "reference"];
const LINE: RegExp = /^[-*]?\s*([a-z]+)\s*\|\s*(.+)$/;
// Chaves e tokens comuns: candidato com cara de segredo é descartado, segredo nunca entra na memória.
const SECRET: RegExp = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,})/;

export interface Candidate {
  readonly kind: string;
  readonly text: string;
}

// Mesma chamada do resumo (modelo e limites de HAIKU_SUMMARY), só com outro system.
export const CAPTURE_SYSTEM: string = `Você extrai, do registro de uma sessão de trabalho, até ${MAX_CANDIDATES} fatos que valem virar memória durável: decisão tomada com o motivo, armadilha descoberta, regra de trabalho dita pelo usuário, procedimento que se repete. Ignore o que só vale nesta sessão e o que o código ou o git já registram. Responda só com linhas no formato "kind | texto", com kind em ${KINDS.join(", ")} e texto de uma frase (até ${MAX_TEXT_BYTES} bytes), em português. Se nada valer, responda vazio. Nunca inclua segredo, senha ou token.`;

export function candidatesPrompt(body: string): string {
  return `Registro da sessão:\n\n${body}`;
}

function parseLine(line: string): Candidate | undefined {
  const match: RegExpExecArray | null = LINE.exec(line.trim());
  const kind: string = match?.[1] ?? "";
  const text: string = (match?.[2] ?? "").trim();
  const valid: boolean =
    KINDS.includes(kind) &&
    text !== "" &&
    new TextEncoder().encode(text).length <= MAX_TEXT_BYTES &&
    !SECRET.test(text);
  return valid ? { kind, text } : undefined;
}

export function parseCandidates(reply: string): Candidate[] {
  return reply
    .split(/\r?\n/)
    .map(parseLine)
    .filter((candidate: Candidate | undefined): candidate is Candidate => candidate !== undefined)
    .slice(0, MAX_CANDIDATES);
}

export function formatCandidates(candidates: readonly Candidate[]): string {
  if (candidates.length === 0) return "";
  const lines: string[] = candidates.map(({ kind, text }: Candidate): string => `- ${kind} | ${text}`);
  return `**Candidatos a memória (revise; grave só os que valem):**\n${lines.join("\n")}`;
}
