import { join } from "node:path";
import { receivedIssue } from "../issue";

type SourceKind = "optmem" | "ai-memory";

interface ListOptions {
  readonly kind: "ai-memory";
  readonly from: string;
  readonly list: true;
}

interface ApplyOptions {
  readonly from: string;
  readonly list: false;
  readonly dest: string;
  readonly apply: boolean;
}

export type MigrationOptions = ListOptions | (ApplyOptions & (
  { readonly kind: "optmem" } | { readonly kind: "ai-memory"; readonly project: string }
));

interface PathDefaults {
  readonly home: string;
  readonly memoryDir?: string;
}

interface ParsedFlags {
  readonly flags: ReadonlyMap<string, string>;
  readonly dest: string | undefined;
}

const USAGE: string = [
  "bun run src/migrate.ts optmem [--from <dir>] [--apply] <dest-memory-dir>",
  "bun run src/migrate.ts ai-memory [--from <wiki-dir>] --project <name> [--apply] <dest-memory-dir>",
  "bun run src/migrate.ts ai-memory [--from <wiki-dir>] --list",
].join(" or ");

function invalid(received: unknown): never {
  const message: string = receivedIssue("migration", "arguments", received, USAGE).message;
  throw new Error(message);
}

function readFlags(args: readonly string[]): ParsedFlags {
  const flags: Map<string, string> = new Map();
  let dest: string | undefined;
  for (let index: number = 1; index < args.length; index++) {
    const arg: string = args[index] ?? "";
    if (arg === "" || flags.has(arg)) invalid(args);
    if (arg === "--apply" || arg === "--list") {
      flags.set(arg, "");
    } else if (arg === "--from" || arg === "--project") {
      const value: string | undefined = args[++index];
      if (value === undefined || value === "" || value.startsWith("--")) invalid(args);
      flags.set(arg, value);
    } else {
      if (dest !== undefined || arg.startsWith("-")) invalid(args);
      dest = arg;
    }
  }
  return { flags, dest };
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function sourceDirectory(kind: SourceKind, explicit: string | undefined, paths: PathDefaults): string {
  const fallback: string = kind === "optmem"
    ? paths.memoryDir || "~/.optmem/memory"
    : "~/.local/share/ai-memory/wiki";
  return expandHome(explicit ?? fallback, paths.home);
}

export function parseMigrationOptions(args: readonly string[], paths: PathDefaults): MigrationOptions {
  const [kind] = args;
  if (kind !== "optmem" && kind !== "ai-memory") invalid(args);
  const { flags, dest }: ParsedFlags = readFlags(args);
  const from: string = sourceDirectory(kind, flags.get("--from"), paths);
  const project: string | undefined = flags.get("--project");
  const apply: boolean = flags.has("--apply");
  if (flags.has("--list")) {
    if (kind !== "ai-memory" || project !== undefined || dest !== undefined || apply) invalid(args);
    return { kind, from, list: true };
  }
  if (dest === undefined) invalid(args);
  const options: ApplyOptions = { from, list: false, dest: expandHome(dest, paths.home), apply };
  if (kind === "optmem" && project === undefined) return { ...options, kind };
  if (kind === "ai-memory" && project !== undefined) return { ...options, kind, project };
  return invalid(args);
}
