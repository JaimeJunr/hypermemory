import { expect, test } from "bun:test";
import { visitIndexTargets } from "../src/indexes";
import { markdownLines } from "../src/markdown";
import { planIndexes, type IndexEdit, type IndexPage } from "../src/migration/index-plan";

function fact(name: string, kind: IndexPage["kind"] = "concept", title: string = name): IndexPage {
  const description: string = "A fact";
  return { name, kind, title, description };
}

function editFor(edits: readonly IndexEdit[], file: string): IndexEdit | undefined {
  const match: IndexEdit | undefined = edits.find((edit: IndexEdit): boolean => edit.file === file);
  return match;
}

test("appends escaped index titles at exactly the 150-line boundary", (): void => {
  const previous: string = "entry\r\n".repeat(148) + "entry";
  const edits: IndexEdit[] = planIndexes(new Map([["MEMORY.md", previous]]), [fact("x", "decision", "Title [v2]")]);
  const entry: string = "- [Title \\[v2\\]](x.md) — A fact";
  expect(edits).toEqual([{ file: "MEMORY.md", content: previous + "\n" + entry + "\n", lines: [entry] }]);
  expect(markdownLines(edits[0]?.content ?? "")).toHaveLength(150);
});

test("detects links in main and domain indexes, including encoded filenames and anchors", (): void => {
  const indexes: Map<string, string> = new Map([
    ["MEMORY.md", "- [X](./x.md#part)\n- [Area](index-area.md)"],
    ["index-area.md", "- [Y](%79.md?query=1)\n<!-- - [Z](z.md) -->\n"],
  ]);
  expect(planIndexes(indexes, [fact("x"), fact("y")])).toEqual([]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x"), fact("y"), fact("z")]);
  expect(edits[0]?.lines).toEqual(["- [z](z.md) — A fact"]);
});

test("splits overflow by kind and writes counts and headings at the 150-line boundary", (): void => {
  const previous: string = "entry\n".repeat(148);
  const edits: IndexEdit[] = planIndexes(new Map([["MEMORY.md", previous]]), [fact("a"), fact("b"), fact("c", "rule")]);
  expect(editFor(edits, "index-concept.md")?.content).toBe("# Concept\n- [a](a.md) — A fact\n- [b](b.md) — A fact\n");
  expect(editFor(edits, "index-rule.md")?.content).toBe("# Rule\n- [c](c.md) — A fact\n");
  expect(editFor(edits, "MEMORY.md")?.lines).toEqual([
    "- [Concept](index-concept.md) — 2 memórias de concept migradas do ai-memory",
    "- [Rule](index-rule.md) — 1 memórias de rule migradas do ai-memory",
  ]);
  expect(markdownLines(editFor(edits, "MEMORY.md")?.content ?? "")).toHaveLength(150);
});

test("extends an existing kind index and keeps its pre-existing top-level link", (): void => {
  const memory: string = "entry\n".repeat(149) + "- [Concept](index-concept.md)\n";
  const concept: string = "# Project notes\n\n- [Old](old.md) — Past\n";
  const edits: IndexEdit[] = planIndexes(new Map([["MEMORY.md", memory], ["index-concept.md", concept]]), [fact("a"), fact("b")]);
  expect(edits).toEqual([{
    file: "index-concept.md",
    content: concept + "- [a](a.md) — A fact\n- [b](b.md) — A fact\n",
    lines: ["- [a](a.md) — A fact", "- [b](b.md) — A fact"],
  }]);
});

test("preserves a full index in a separate file when the top-level kind link cannot fit", (): void => {
  const previous: string = "entry\n".repeat(150);
  const indexes: Map<string, string> = new Map([["MEMORY.md", previous], ["index-existing.md", "# Other"]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x")]);
  expect(editFor(edits, "index-existing.md")).toBeUndefined();
  expect(editFor(edits, "index-existing-2.md")?.content).toContain(previous);
  expect(editFor(edits, "MEMORY.md")?.lines).toEqual([
    "- [Existing memories](index-existing-2.md) — Índice anterior",
    "- [Concept](index-concept.md) — 1 memórias de concept migradas do ai-memory",
  ]);
});

test("splits long index entries when the validator's byte budget would be exceeded", (): void => {
  const indexes: Map<string, string> = new Map([["MEMORY.md", "é".repeat(12460) + "\n"]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x", "concept", "Title ".repeat(20).trimEnd())]);
  expect(editFor(edits, "index-concept.md")?.lines).toHaveLength(1);
  expect(Buffer.byteLength(editFor(edits, "MEMORY.md")?.content ?? "")).toBeLessThanOrEqual(25000);
});

test("recovers a kind index written before its top-level link without duplicating page lines", (): void => {
  const previous: string = "entry\n".repeat(148);
  const domain: string = "# Concept\n- [x](x.md) — A fact\n";
  const indexes: Map<string, string> = new Map([["MEMORY.md", previous], ["index-concept.md", domain]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x"), fact("y")]);
  expect(editFor(edits, "index-concept.md")?.content).toBe(domain + "- [y](y.md) — A fact\n");
  expect(editFor(edits, "MEMORY.md")?.lines).toEqual([
    "- [Concept](index-concept.md) — 2 memórias de concept migradas do ai-memory",
  ]);
});

test("reuses an already preserved copy of the old top-level index on retry", (): void => {
  const previous: string = "entry\n".repeat(150);
  const indexes: Map<string, string> = new Map([["MEMORY.md", previous], ["index-existing.md", previous]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x")]);
  expect(editFor(edits, "index-existing.md")).toBeUndefined();
  expect(editFor(edits, "index-existing-2.md")).toBeUndefined();
  expect(editFor(edits, "MEMORY.md")?.lines[0]).toContain("(index-existing.md)");
});

test("shrinks an already oversized main index when adding pages to an already linked kind index", (): void => {
  const main: string = "entry\n".repeat(150) + "- [Concept](index-concept.md)\n";
  const indexes: Map<string, string> = new Map([["MEMORY.md", main], ["index-concept.md", "# Concept\n"]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x")]);
  expect(editFor(edits, "index-concept.md")?.lines).toEqual(["- [x](x.md) — A fact"]);
  expect(editFor(edits, "index-existing.md")?.content).toBe(main);
  expect(editFor(edits, "MEMORY.md")?.lines).toEqual(["- [Existing memories](index-existing.md) — Índice anterior"]);
});

test("shrinks a main index already over the byte budget even when no new kind link is needed", (): void => {
  const main: string = "é".repeat(12600) + "\n- [Concept](index-concept.md)\n";
  const indexes: Map<string, string> = new Map([["MEMORY.md", main], ["index-concept.md", "# Concept\n"]]);
  const edits: IndexEdit[] = planIndexes(indexes, [fact("x")]);
  expect(editFor(edits, "index-existing.md")?.content.length).toBe(main.length);
  expect(markdownLines(editFor(edits, "MEMORY.md")?.content ?? "")).toHaveLength(1);
});

test("sanitizes an unbalanced code span and trims both index fields at whole words", (): void => {
  const title: string = "Para posts novos, use `teams_send_channel_message` com o assunto no campo `subje";
  const description: string = "  Use   [notes] for the  " + "configuration ".repeat(8) + "`partial";
  const page: IndexPage = { ...fact("teams-send-channel", "concept", title), description };
  const [edit] = planIndexes(new Map(), [page]);
  const links: string[] = [];
  visitIndexTargets(edit?.content ?? "", (target: string): void => { links.push(target); });
  expect(links).toEqual(["teams-send-channel.md"]);
  expect(edit?.lines).toEqual([
    "- [Para posts novos, use teams_send_channel_message com o assunto no campo subje](teams-send-channel.md)"
      + " — Use \\[notes\\] for the configuration configuration configuration configuration…",
  ]);
});
