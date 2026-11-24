import { expect, test } from "bun:test";
import { type AgingInput, findStale } from "../src/aging";

const NOW: Date = new Date("2026-11-24T12:00:00Z");
const OLD: Date = new Date("2026-01-01T00:00:00Z");

function page(metadata: string, body: string = "Um fato."): string {
  return `---\nname: fato\ndescription: "d"\nmetadata:\n  type: project\n${metadata}---\n\n${body}\n`;
}

function input(file: string, content: string, mtime: Date = OLD): AgingInput {
  return { file, content, mtime };
}

test("memória sem toque há mais que o limite aparece, com a idade em dias", (): void => {
  const stale = findStale([input("a.md", page(""))], NOW, 180);
  expect(stale).toEqual([{ file: "a.md", lastTouched: "2026-01-01", ageDays: 327 }]);
});

test("memória dentro do limite não aparece", (): void => {
  expect(findStale([input("a.md", page(""), new Date("2026-10-01T00:00:00Z"))], NOW, 180)).toEqual([]);
});

test("conferido em ou medido em no corpo renova a data, vale a mais recente", (): void => {
  const body = "Medido em 2026-02-01. Conferido em 2026-11-01.";
  expect(findStale([input("a.md", page("", body))], NOW, 180)).toEqual([]);
});

test("metadata.modified vale mais que a data do arquivo", (): void => {
  const fresh = page("  modified: 2026-11-10\n");
  expect(findStale([input("a.md", fresh)], NOW, 180)).toEqual([]);
});

test("pinned, superseded e handoff nunca envelhecem", (): void => {
  const files: AgingInput[] = [
    input("p.md", page("  pinned: true\n")),
    input("s.md", page("  status: superseded\n  superseded_by: outro\n")),
    input("h.md", page("  kind: session\n  status: open\n")),
  ];
  expect(findStale(files, NOW, 180)).toEqual([]);
});

test("índice, diário e arquivo sem frontmatter são ignorados", (): void => {
  const files: AgingInput[] = [
    input("MEMORY.md", "- [x](a.md)"),
    input("LOG.md", "2026-01-01 | event | x"),
    input("index-ivt.md", page("")),
    input("solto.md", "sem frontmatter"),
  ];
  expect(findStale(files, NOW, 180)).toEqual([]);
});

test("a lista sai da mais velha para a mais nova", (): void => {
  const files: AgingInput[] = [
    input("nova.md", page(""), new Date("2026-03-01T00:00:00Z")),
    input("velha.md", page(""), new Date("2025-12-01T00:00:00Z")),
  ];
  expect(findStale(files, NOW, 180).map((item) => item.file)).toEqual(["velha.md", "nova.md"]);
});

test("o limite é exclusivo: exatamente N dias não aparece, N+1 aparece", (): void => {
  const noLimite: AgingInput = input("a.md", page(""), new Date("2026-05-28T00:00:00Z"));
  const umDiaAlem: AgingInput = input("b.md", page(""), new Date("2026-05-27T00:00:00Z"));
  expect(findStale([noLimite, umDiaAlem], NOW, 180).map((item) => item.file)).toEqual(["b.md"]);
});
