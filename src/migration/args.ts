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

export type MigrationOptions =
  | ListOptions
  | (ApplyOptions & ({ readonly kind: "optmem" } | { readonly kind: "ai-memory"; readonly project: string }));

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

function argumentAt(args: readonly string[], index: number): string {
  const value: string | undefined = args[index];
  if (value === undefined || value === "") invalid(args);
  return value;
}

function flagValue(args: readonly string[], index: number): string {
  const value: string = argumentAt(args, index);
  if (value.startsWith("--")) invalid(args);
  return value;
}

function readFlags(args: readonly string[]): ParsedFlags {
  const flags: Map<string, string> = new Map();
  let dest: string | undefined;
  for (let index: number = 1; index < args.length; index++) {
    const arg: string = argumentAt(args, index);
    if (flags.has(arg)) invalid(args);
    switch (arg) {
      case "--apply":
      case "--list":
        flags.set(arg, "");
        break;
      case "--from":
      case "--project":
        flags.set(arg, flagValue(args, ++index));
        break;
      default:
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
  const fallback: string = kind === "optmem" ? paths.memoryDir || "~/.optmem/memory" : "~/.local/share/ai-memory/wiki";
  return expandHome(explicit ?? fallback, paths.home);
}

function listOptions(
  args: readonly string[],
  kind: SourceKind,
  from: string,
  { flags, dest }: ParsedFlags,
): ListOptions {
  if (kind !== "ai-memory" || flags.has("--project") || dest !== undefined || flags.has("--apply")) invalid(args);
  return { kind, from, list: true };
}

export function parseMigrationOptions(args: readonly string[], paths: PathDefaults): MigrationOptions {
  const [kind] = args;
  if (kind !== "optmem" && kind !== "ai-memory") invalid(args);
  const parsed: ParsedFlags = readFlags(args);
  const { flags, dest }: ParsedFlags = parsed;
  const from: string = sourceDirectory(kind, flags.get("--from"), paths);
  if (flags.has("--list")) return listOptions(args, kind, from, parsed);
  const project: string | undefined = flags.get("--project");
  const apply: boolean = flags.has("--apply");
  if (dest === undefined) invalid(args);
  const options: ApplyOptions = { from, list: false, dest: expandHome(dest, paths.home), apply };
  if (kind === "optmem" && project === undefined) return { ...options, kind };
  if (kind === "ai-memory" && project !== undefined) return { ...options, kind, project };
  return invalid(args);
}
