import { expect, test } from "bun:test";
import { check } from "./fixtures";

const LOG_KINDS: readonly string[] = [
  "profile",
  "rule",
  "decision",
  "gotcha",
  "procedure",
  "concept",
  "session",
  "reference",
  "event",
];

test("LOG.md accepts all nine kinds, real leap dates, and text containing a pipe", (): void => {
  const entries: string[] = LOG_KINDS.map((kind: string): string => `2024-02-29 | ${kind} | Note | details`);
  const content: string = ["", "   ", "<!-- ignored | even if it resembles an entry -->", ...entries, ""].join("\r\n");
  expect(check({ "LOG.md": content }).issues).toEqual([]);
  expect(check({ "LOG.md": "2000-02-29 | event | Century leap year\n0099-01-01 | event | Early year" }).issues).toEqual(
    [],
  );
});

test("LOG.md reports invalid syntax, kinds, and blank text with physical line numbers", (): void => {
  const content: string = [
    "<!-- comment -->",
    "",
    "2026-11-19|event|No spaces",
    "2026-11-19 | projetc | Unknown kind",
    "2026-11-19 | event | ",
    "2026-11-19 | event |   \t",
  ].join("\n");
  expect(check({ "LOG.md": content }).issues).toEqual([
    {
      file: "LOG.md",
      line: 3,
      message: 'line format: received "2026-11-19|event|No spaces", expected YYYY-MM-DD | <kind> | <text>',
    },
    {
      file: "LOG.md",
      line: 4,
      message:
        'kind: received "projetc", expected one of profile|rule|decision|gotcha|procedure|concept|session|reference|event',
    },
    { file: "LOG.md", line: 5, message: 'text: received "", expected a non-empty string' },
    { file: "LOG.md", line: 6, message: 'text: received "  \\t", expected a non-empty string' },
  ]);
});

test("LOG.md rejects impossible and unpadded dates", (): void => {
  const invalidDates: readonly string[] = ["2026-02-29", "2026-04-31", "2026-13-01", "1900-02-29", "2026-1-09"];
  for (const date of invalidDates) {
    expect(check({ "LOG.md": `${date} | event | Note` }).issues).toEqual([
      {
        file: "LOG.md",
        line: 1,
        message: `date: received ${JSON.stringify(date)}, expected a real date in YYYY-MM-DD format`,
      },
    ]);
  }
});

test("LOG.md accepts 280 UTF-8 bytes of text and rejects 281", (): void => {
  const entry: string = `2026-11-19 | event | ${"á".repeat(140)}`;
  expect(check({ "LOG.md": entry }).issues).toEqual([]);
  expect(check({ "LOG.md": `${entry}x` }).issues).toEqual([
    { file: "LOG.md", line: 1, message: "text byte count: received 281, expected at most 280 UTF-8 bytes" },
  ]);
});
