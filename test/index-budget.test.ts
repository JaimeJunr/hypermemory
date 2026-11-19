import { expect, test } from "bun:test";
import type { ValidationResult } from "../src/validator";
import { check, markedIndex } from "./fixtures";

test("MEMORY.md accepts exactly 150 lines with CRLF and a final newline", (): void => {
  const content: string = "entry\r\n".repeat(149);
  const result: ValidationResult = check({ "MEMORY.md": content });
  expect(result.issues).toEqual([]);
  expect(result.indexLines).toBe(150);
  expect(check({}).indexLines).toBe(1);
  expect(check({ "MEMORY.md": "entry\n\n" }).indexLines).toBe(3);
});

test("MEMORY.md rejects 151 lines even below the byte limit", (): void => {
  const content: string = `${"entry\n".repeat(149)}entry`;
  expect(check({ "MEMORY.md": content }).issues).toEqual([
    { file: "MEMORY.md", message: "line count: received 151, expected at most 150 lines" },
  ]);
});

test("MEMORY.md accepts exactly 25000 UTF-8 bytes and rejects one more", (): void => {
  const available: number = 25000 - Buffer.byteLength(markedIndex());
  const boundary: string = "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
  expect(check({ "MEMORY.md": boundary }).issues).toEqual([]);
  expect(check({ "MEMORY.md": `${boundary}x` }).issues).toEqual([
    { file: "MEMORY.md", message: "byte count: received 25001, expected at most 25000 UTF-8 bytes" },
  ]);
});
