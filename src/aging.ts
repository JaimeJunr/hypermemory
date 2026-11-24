import { isMapping, splitFrontmatter } from "./frontmatter";

export interface AgingInput {
  readonly file: string;
  readonly content: string;
  readonly mtime: Date;
}

export interface StaleMemory {
  readonly file: string;
  readonly lastTouched: string;
  readonly ageDays: number;
}

const DAY_MS: number = 86_400_000;
const RESERVED: RegExp = /^(MEMORY|LOG)\.md$|^index-/;
const CHECKED_DATE: RegExp = /(?:conferid[oa]|medid[oa])\s+em\s+(\d{4}-\d{2}-\d{2})/gi;

function metadataOf(content: string): Readonly<Record<string, unknown>> | undefined {
  const { yaml } = splitFrontmatter(content);
  if (yaml === undefined) return undefined;
  try {
    const parsed: unknown = Bun.YAML.parse(yaml);
    return isMapping(parsed) && isMapping(parsed.metadata) ? parsed.metadata : undefined;
  } catch {
    return undefined;
  }
}

function isExempt(metadata: Readonly<Record<string, unknown>>): boolean {
  return metadata.pinned === true || metadata.status === "superseded" || metadata.kind === "session";
}

function isoDay(value: unknown): string | undefined {
  const text: string = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
}

// A data mais recente entre `modified`, as datas "conferido/medido em" do corpo e a data do arquivo.
function lastTouched(metadata: Readonly<Record<string, unknown>>, content: string, mtime: Date): string {
  const body: string[] = [...content.matchAll(CHECKED_DATE)].map((match: RegExpMatchArray): string => match[1] ?? "");
  const days: (string | undefined)[] = [isoDay(metadata.modified), ...body, mtime.toISOString().slice(0, 10)];
  return (
    days
      .filter((day: string | undefined): day is string => day !== undefined)
      .sort()
      .at(-1) ?? ""
  );
}

function ageInDays(day: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / DAY_MS);
}

// Só aponta: quem decide se a memória ainda vale é a pessoa, que re-confere, substitui ou fixa com pinned.
export function findStale(files: readonly AgingInput[], now: Date, days: number): StaleMemory[] {
  const stale: StaleMemory[] = [];
  for (const { file, content, mtime } of files) {
    const metadata: Readonly<Record<string, unknown>> | undefined = RESERVED.test(file)
      ? undefined
      : metadataOf(content);
    if (metadata === undefined || isExempt(metadata)) continue;
    const touched: string = lastTouched(metadata, content, mtime);
    const age: number = ageInDays(touched, now);
    if (age > days) stale.push({ file, lastTouched: touched, ageDays: age });
  }
  return stale.sort((a: StaleMemory, b: StaleMemory): number => b.ageDays - a.ageDays);
}
