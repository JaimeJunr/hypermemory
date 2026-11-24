import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type AgingInput, findStale, type StaleMemory } from "./aging";

const DEFAULT_DAYS: number = 180;
const USAGE: string = "usage: hypermemory aging <memory-dir> [--days N]";

interface AgingResult {
  readonly exitCode: 0 | 1;
  readonly output: readonly string[];
}

type LoadFiles = (directory: string) => readonly AgingInput[];

function parseDays(args: readonly string[]): number | undefined {
  const at: number = args.indexOf("--days");
  if (at < 0) return DEFAULT_DAYS;
  const days: number = Number(args[at + 1]);
  return Number.isInteger(days) && days > 0 ? days : undefined;
}

export function loadDirectory(directory: string): AgingInput[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry): AgingInput => {
      const path: string = join(directory, entry.name);
      return { file: entry.name, content: readFileSync(path, "utf8"), mtime: statSync(path).mtime };
    });
}

export function runAging(args: readonly string[], load: LoadFiles, now: Date): AgingResult {
  const directory: string | undefined = args[0];
  const days: number | undefined = parseDays(args);
  if (directory === undefined || directory.startsWith("--") || days === undefined) {
    return { exitCode: 1, output: [USAGE] };
  }
  try {
    const stale: StaleMemory[] = findStale(load(directory), now, days);
    if (stale.length === 0) return { exitCode: 0, output: [`ok: nenhuma memória sem toque há mais de ${days} dias`] };
    const lines: string[] = stale.map(
      (item: StaleMemory): string => `${item.file}: sem toque desde ${item.lastTouched} (${item.ageDays} dias)`,
    );
    return { exitCode: 0, output: [...lines, "Re-confira, substitua (status: superseded) ou fixe (pinned: true)."] };
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, output: [`${directory}: could not read directory: ${JSON.stringify(reason)}`] };
  }
}

if (import.meta.main) {
  const result: AgingResult = runAging(Bun.argv.slice(2), loadDirectory, new Date());
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
