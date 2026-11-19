import { expect, test } from "bun:test";
import { GitPreviousLogReader, type GitResult, type GitRunner } from "../src/readers";

class FakeGitRunner implements GitRunner {
  readonly calls: Array<readonly [string, ...string[]]> = [];

  constructor(private readonly results: readonly GitResult[]) {}

  run(directory: string, args: readonly string[]): GitResult {
    const result: GitResult | undefined = this.results[this.calls.length];
    this.calls.push([directory, ...args]);
    if (result === undefined) throw new Error("Unexpected Git command: " + args.join(" "));
    return result;
  }
}

function gitResult(stdout: string, exitCode: number = 0, stderr: string = ""): GitResult {
  return { exitCode, stdout, stderr };
}

test("Git reads HEAD using the path relative to its repository and preserves the log bytes", (): void => {
  const content: string = "2026-11-19 | event | Décision\r\n";
  const git: FakeGitRunner = new FakeGitRunner([
    gitResult("nested dir/memory/\n"),
    gitResult("head-object\n"),
    gitResult("100644 blob oid\tnested dir/memory/LOG.md\0"),
    gitResult(content),
  ]);
  expect(new GitPreviousLogReader("/repo/nested dir/memory", git).read()).toBe(content);
  expect(git.calls).toEqual([
    ["/repo/nested dir/memory", "rev-parse", "--show-prefix"],
    ["/repo/nested dir/memory", "rev-parse", "--verify", "--quiet", "HEAD"],
    ["/repo/nested dir/memory", "ls-tree", "--full-tree", "-z", "HEAD", "--", ":(top,literal)nested dir/memory/LOG.md"],
    ["/repo/nested dir/memory", "show", "HEAD:nested dir/memory/LOG.md"],
  ]);
});

test("Git skips an unborn HEAD, a missing HEAD log, and a directory outside Git", (): void => {
  const cases: readonly (readonly GitResult[])[] = [
    [gitResult("memory/\n"), gitResult("", 1)],
    [gitResult("memory/\n"), gitResult("head-object\n"), gitResult("")],
    [gitResult("", 128, "fatal: not a git repository (or any of the parent directories): .git")],
    [gitResult("\n"), gitResult("head-object\n"), gitResult("040000 tree oid\tLOG.md\0")],
  ];
  for (const results of cases) {
    const git: FakeGitRunner = new FakeGitRunner(results);
    expect(new GitPreviousLogReader("/fixture", git).read()).toBeUndefined();
    expect(git.calls).toHaveLength(results.length);
  }
});

test("Git surfaces unexpected failures instead of treating them as missing history", (): void => {
  const git: FakeGitRunner = new FakeGitRunner([gitResult("", 128, "fatal: repository access denied")]);
  expect((): string | undefined => new GitPreviousLogReader("/fixture", git).read()).toThrow("fatal: repository access denied");
});
