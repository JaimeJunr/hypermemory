import { DirectoryMemoryReader, GitPreviousLogReader, ProcessGitRunner } from "./readers";
import {
  type Issue,
  type MemoryReader,
  type PreviousLogReader,
  type ValidationResult,
  validateMemory,
} from "./validator";

export interface MemorySources {
  readonly reader: MemoryReader;
  readonly previousLog: PreviousLogReader;
}

type OpenMemory = (directory: string) => MemorySources;

interface CliResult {
  readonly exitCode: 0 | 1;
  readonly output: readonly string[];
}

export function formatIssue(issue: Issue): string {
  const file: string = issue.file.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  const location: string = issue.line === undefined ? file : `${file}:${issue.line}`;
  return `${location}: ${issue.message}`;
}

export function runCli(args: readonly string[], openMemory: OpenMemory): CliResult {
  const [directory] = args;
  if (args.length !== 1 || directory === undefined || directory === "") {
    return { exitCode: 1, output: ["usage: bun run src/cli.ts <memory-dir>"] };
  }
  try {
    const { reader, previousLog }: MemorySources = openMemory(directory);
    const result: ValidationResult = validateMemory(reader, previousLog);
    if (result.issues.length > 0) {
      return { exitCode: 1, output: result.issues.map(formatIssue) };
    }
    const summary: string = `ok: ${result.memoryFiles} memory files, MEMORY.md ${result.indexLines} lines`;
    return { exitCode: 0, output: [summary] };
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error);
    const output: string = formatIssue({
      file: directory,
      message: `could not validate directory: ${JSON.stringify(reason)}`,
    });
    return { exitCode: 1, output: [output] };
  }
}

export function openDirectory(directory: string): MemorySources {
  return {
    reader: new DirectoryMemoryReader(directory),
    previousLog: new GitPreviousLogReader(directory, new ProcessGitRunner()),
  };
}

if (import.meta.main) {
  const result: CliResult = runCli(Bun.argv.slice(2), openDirectory);
  for (const line of result.output) console.log(line);
  process.exitCode = result.exitCode;
}
