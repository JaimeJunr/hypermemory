import { expect, test } from "bun:test";
import { readOptMemRecords, type OptMemRecords } from "../src/migration/optmem";

import { optRecord as record } from "./migrate-fixtures";

test("OptMem reads 320-byte records in order, including multi-byte text and both padding styles", (): void => {
  const records: Buffer = Buffer.concat([record("#0 2024-02-29 Café | chá"), record("#1 2026-11-20 日本語", 0)]);
  expect(readOptMemRecords(records)).toEqual({
    lines: ["2024-02-29 | event | Café | chá", "2026-11-20 | event | 日本語"],
    skipped: 0,
    issues: [],
  });
});

test("OptMem skips empty records and preserves the exact 280-byte text boundary", (): void => {
  const text: string = "é".repeat(140);
  const records: Buffer = Buffer.concat([record(""), record("#1 2026-11-19 " + text), record("", 0)]);
  expect(readOptMemRecords(records)).toEqual({
    lines: ["2026-11-19 | event | " + text],
    skipped: 2,
    issues: [],
  });
});

test("OptMem reports malformed records by physical index and raw text, then resumes", (): void => {
  const records: Buffer = Buffer.concat([record("malformed"), record("#7 2026-02-29 impossible"), record("#8 2026-11-20 good")]);
  const result: OptMemRecords = readOptMemRecords(records);
  expect(result.lines).toEqual(["2026-11-20 | event | good"]);
  expect(result.issues).toEqual([
    { file: "LOG.txt", message: expect.stringMatching(/record #0: received "malformed.*expected/) },
    { file: "LOG.txt", message: expect.stringMatching(/record #1: received "#7 2026-02-29 impossible.*expected a real date/) },
  ]);
});

test("OptMem reports long text, embedded newlines, invalid UTF-8, and an incomplete final record", (): void => {
  const invalid: Buffer = record("#2 2026-11-19 ");
  invalid[14] = 255;
  const records: Buffer = Buffer.concat([
    record("#0 2026-11-19 " + "é".repeat(140) + "x"), record("#1 2026-11-19 two\nlines"),
    invalid, Buffer.from("#3 2026-11-19 partial"),
  ]);
  const result: OptMemRecords = readOptMemRecords(records);
  expect(result.lines).toEqual([]);
  expect(result.issues.map(({ message }): string => message)).toEqual([
    expect.stringMatching(/record #0: received .*expected at most 280 UTF-8 bytes/),
    expect.stringMatching(/record #1: received .*expected .*one line/),
    expect.stringMatching(/record #2: received .*expected valid UTF-8/),
    expect.stringMatching(/record #3: received "#3 2026-11-19 partial".*expected exactly 320 bytes/),
  ]);
});
