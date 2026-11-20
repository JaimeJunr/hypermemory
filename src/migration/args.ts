import { isMemoryScope, type MemoryScope, SCOPE_VALUES } from "../format";
import { receivedIssue } from "../issue";
import { expandHome } from "../paths";

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
  readonly scope: MemoryScope;
}

export type MigrationOptions =
  | ListOptions
  | (ApplyOptions &
      (
        | { readonly kind: "optmem" }
        | { readonly kind: "ai-memory"; readonly project: string; readonly personalDest: string | undefined }
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
  `bun run src/migrate.ts optmem [--from <dir>] [--scope ${SCOPE_VALUES}] [--apply] <dest-memory-dir>`,
  `bun run src/migrate.ts ai-memory [--from <wiki-dir>] --project <name> [--personal-dest <dir>] [--scope ${SCOPE_VALUES}] [--apply] <dest-memory-dir>`,
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
      case "--personal-dest":
      case "--scope":
        flags.set(arg, flagValue(args, ++index));
        break;
      default:
        if (dest !== undefined || arg.startsWith("-")) invalid(args);
        dest = arg;
    }
  }
  return { flags, dest };
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
  if (kind !== "ai-memory" || dest !== undefined) invalid(args);
  const incompatible: string[] = ["--project", "--apply", "--scope", "--personal-dest"];
  if (incompatible.some((flag: string): boolean => flags.has(flag))) invalid(args);
  return { kind, from, list: true };
}

function destinationOptions(
  args: readonly string[],
  kind: SourceKind,
  from: string,
  { flags, dest }: ParsedFlags,
  home: string,
): MigrationOptions {
  const project: string | undefined = flags.get("--project");
  const personal: string | undefined = flags.get("--personal-dest");
  const scope: string = flags.get("--scope") ?? "project";
  if (!isMemoryScope(scope))
    throw new Error(receivedIssue("migration", "--scope", scope, `one of ${SCOPE_VALUES}`).message);
  if (dest === undefined) invalid(args);
  const options: ApplyOptions = {
    from,
    list: false,
    dest: expandHome(dest, home),
    apply: flags.has("--apply"),
    scope,
  };
  if (kind === "optmem" && project === undefined && personal === undefined) return { ...options, kind };
  if (kind === "ai-memory" && project !== undefined) {
    const personalDest: string | undefined = personal === undefined ? undefined : expandHome(personal, home);
    return { ...options, kind, project, personalDest };
  }
  return invalid(args);
}

export function parseMigrationOptions(args: readonly string[], paths: PathDefaults): MigrationOptions {
  const [kind] = args;
  if (kind !== "optmem" && kind !== "ai-memory") invalid(args);
  const parsed: ParsedFlags = readFlags(args);
  const from: string = sourceDirectory(kind, parsed.flags.get("--from"), paths);
  if (parsed.flags.has("--list")) return listOptions(args, kind, from, parsed);
  return destinationOptions(args, kind, from, parsed, paths.home);
}
