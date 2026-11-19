import { expect, test } from "bun:test";
import type { Issue } from "../src/validator";
import { check } from "./fixtures";

const TRIALS: number = 64;

class SeededRandom {
  constructor(private state: number) {}

  next(limit: number): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return Math.floor((this.state / 2 ** 32) * limit);
  }
}

function randomEntries(random: SeededRandom, count: number, label: string): string[] {
  return Array.from({ length: count }, (_unused: unknown, index: number): string => {
    const day: string = String(random.next(28) + 1).padStart(2, "0");
    return `2026-11-${day} | event | ${label} ${index} ${random.next(10000)}\n`;
  });
}

function expectPrefixIssue(previous: string, current: string): void {
  const issues: readonly Issue[] = check({ "LOG.md": current }, previous).issues;
  expect(issues).toEqual([
    { file: "LOG.md", message: expect.stringMatching(/append-only prefix: received .*expected/) },
  ]);
}

test("append-only accepts random appended lines on 64 seeded histories", (): void => {
  const random: SeededRandom = new SeededRandom(20261119);
  for (let trial: number = 0; trial < TRIALS; trial++) {
    const previous: string = randomEntries(random, 1 + random.next(12), "Past").join("");
    const suffix: string = randomEntries(random, 1 + random.next(9), "New").join("");
    expect(check({ "LOG.md": previous + suffix }, previous).issues).toEqual([]);
  }
});

test("append-only rejects an edit and a removal at every historical line across the same 64 histories", (): void => {
  const random: SeededRandom = new SeededRandom(20261119);
  for (let trial: number = 0; trial < TRIALS; trial++) {
    const entries: string[] = randomEntries(random, 1 + random.next(12), "Past");
    const previous: string = entries.join("");
    const suffix: string = randomEntries(random, 1 + random.next(9), "New").join("");
    for (const index of entries.keys()) {
      const edited: string[] = entries.map((line: string, candidate: number): string =>
        candidate === index ? line.replace("Past", "Edit") : line,
      );
      const removed: string[] = entries.filter((_line: string, candidate: number): boolean => candidate !== index);
      expectPrefixIssue(previous, edited.join("") + suffix);
      expectPrefixIssue(previous, removed.join("") + suffix);
    }
  }
});

test("append-only permits absent history, empty history, and identical content", (): void => {
  const content: string = "2026-11-19 | event | Current";
  for (const previous of [undefined, "", content]) {
    expect(check({ "LOG.md": content }, previous).issues).toEqual([]);
  }
  expect(check({ "LOG.md": `${content}\n2026-11-20 | event | Next\n` }, content).issues).toEqual([]);
});

test("append-only rejects deleting the log and changing historical line endings", (): void => {
  const previous: string = "2026-11-19 | event | Current\r\n";
  expectPrefixIssue(previous, "");
  expectPrefixIssue(previous, previous.replace("\r\n", "\n"));
});
