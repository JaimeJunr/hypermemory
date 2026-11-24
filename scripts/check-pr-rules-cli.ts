// Roda no job static do CI: PR_BASE_SHA é o commit-base do pull request.
import { checkPrRules } from "./check-pr-rules";

if (import.meta.main) {
  const base: string | undefined = process.env.PR_BASE_SHA;
  if (base === undefined || base === "") {
    console.log("skip: sem PR_BASE_SHA (não é um pull request)");
  } else {
    const diff = Bun.spawnSync(["git", "diff", "--name-only", `${base}...HEAD`]);
    if (diff.exitCode !== 0) throw new Error(`git diff failed: ${diff.stderr.toString("utf8")}`);
    const files: string[] = diff.stdout.toString("utf8").split("\n").filter(Boolean);
    const problems: string[] = checkPrRules(files);
    for (const problem of problems) console.log(`error: ${problem}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  }
}
