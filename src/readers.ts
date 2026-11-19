import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { MemoryReader, PreviousLogReader } from "./validator";

export class DirectoryMemoryReader implements MemoryReader {
  constructor(
    private readonly directory: string,
  ) {}

  list(): string[] {
    const entries: Dirent[] = readdirSync(this.directory, { withFileTypes: true });
    return entries.filter((entry: Dirent): boolean => entry.isFile()).map((entry: Dirent): string => entry.name);
  }

  read(file: string): string {
    const path: string = join(this.directory, file);
    return readFileSync(path, "utf8");
  }
}

export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunner {
  run(directory: string, args: readonly string[]): GitResult;
}

export class ProcessGitRunner implements GitRunner {
  run(directory: string, args: readonly string[]): GitResult {
    const result: Bun.ReadableSyncSubprocess = Bun.spawnSync(["git", "-C", directory, ...args], {
      env: { ...process.env, LC_ALL: "C" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    };
  }
}

function gitOutput(result: GitResult): string {
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Git exited with status " + result.exitCode);
  }
  return result.stdout;
}

export class GitPreviousLogReader implements PreviousLogReader {
  constructor(
    private readonly directory: string,
    private readonly git: GitRunner,
  ) {}

  read(): string | undefined {
    const prefix: GitResult = this.git.run(this.directory, ["rev-parse", "--show-prefix"]);
    if (prefix.exitCode === 128 && prefix.stderr.startsWith("fatal: not a git repository")) return undefined;
    const logPath: string = gitOutput(prefix).replace(/\n$/, "") + "LOG.md";
    const head: GitResult = this.git.run(this.directory, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.exitCode === 1) return undefined;
    gitOutput(head);
    const treeEntry: string = gitOutput(this.git.run(this.directory, [
      "ls-tree", "--full-tree", "-z", "HEAD", "--", ":(top,literal)" + logPath,
    ]));
    if (!/^\d+ blob /.test(treeEntry)) return undefined;
    return gitOutput(this.git.run(this.directory, ["show", "HEAD:" + logPath]));
  }
}
