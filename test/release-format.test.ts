import { expect, test } from "bun:test";
import { CURRENT_FORMAT, formatMarker, readFormat } from "../src/format";

test("the real changelog records the current memory format on its own line", async (): Promise<void> => {
  const changelog: Bun.BunFile = Bun.file(new URL("../CHANGELOG.md", import.meta.url));
  expect(await changelog.exists()).toBe(true);
  const lines: string[] = (await changelog.text()).split(/\r?\n/);
  expect(lines).toContain(`Formato da memória: ${CURRENT_FORMAT}`);
});

test("the memory skeleton starts with the current marker followed by the existing comment", async (): Promise<void> => {
  const skeleton: string = await Bun.file(new URL("../memory/MEMORY.md", import.meta.url)).text();
  const [first, second] = skeleton.split(/\r?\n/, 2);
  expect(first).toBe(formatMarker(CURRENT_FORMAT));
  expect(second).toStartWith("<!-- Índice Hypermemory:");
  expect(readFormat(skeleton)).toBe(BigInt(CURRENT_FORMAT));
});
