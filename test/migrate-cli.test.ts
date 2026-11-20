import { expect, test } from "bun:test";
import { runMigration } from "../src/migrate";
import { markedIndex, memory } from "./fixtures";
import {
  FakeMigrationDestination,
  FakeMigrationIO,
  FakeMigrationSource,
  optRecord,
  projectFiles,
} from "./migrate-fixtures";

const PROJECT: string = "/wiki/workspace/project";
const PROJECT_ARGS: readonly string[] = ["ai-memory", "--from", "/wiki", "--project", "Team", "/dest"];
const OPT_ARGS: readonly string[] = ["optmem", "--from", "/opt", "/dest"];

function withProject(pages: Record<string, string>, destination?: FakeMigrationDestination): FakeMigrationIO {
  const source: FakeMigrationSource = new FakeMigrationSource(projectFiles(PROJECT, "Team", pages));
  return new FakeMigrationIO(source, destination);
}

function withRecords(records: readonly string[], destination?: FakeMigrationDestination): FakeMigrationIO {
  const bytes: Buffer = Buffer.concat(records.map((line: string): Buffer => optRecord(line)));
  return new FakeMigrationIO(new FakeMigrationSource({}, { "/opt/LOG.txt": bytes }), destination);
}

test("CLI rejects missing operands and flags or options incompatible with the source kind", (): void => {
  const io: FakeMigrationIO = withRecords([]);
  const cases: readonly (readonly string[])[] = [
    [],
    ["unknown", "/dest"],
    ["optmem"],
    ["ai-memory", "/dest"],
    ["ai-memory", "--project", "Team"],
    ["optmem", "--from", "--apply", "/dest"],
    ["optmem", "--project", "Team", "/dest"],
    ["ai-memory", "--list", "--apply"],
    ["ai-memory", "--list", "--project", "Team"],
    ["ai-memory", "--list", "/dest"],
    ["optmem", "--bogus", "/dest"],
    ["optmem", "--from", "/one", "--from", "/two", "/dest"],
  ];
  for (const args of cases) {
    const result: ReturnType<typeof runMigration> = runMigration(args, io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).toMatch(/received .*expected .*bun run src\/migrate\.ts/);
  }
  expect(io.opened).toEqual([]);
  expect(io.source.binaryReads).toEqual([]);
});

test("CLI uses MEMORY_DIR or the home default for OptMem and honors explicit --from", (): void => {
  const binaries: Record<string, Uint8Array> = {
    "/custom/LOG.txt": optRecord("#0 2026-11-19 Custom"),
    "/home/test/.optmem/memory/LOG.txt": optRecord("#0 2026-11-19 Home"),
    "/explicit/LOG.txt": optRecord("#0 2026-11-19 Explicit"),
  };
  const source: FakeMigrationSource = new FakeMigrationSource({}, binaries);
  const custom: FakeMigrationIO = new FakeMigrationIO(source, undefined, "/custom");
  const home: FakeMigrationIO = new FakeMigrationIO(source);
  expect(runMigration(["optmem", "/dest"], custom).exitCode).toBe(0);
  expect(runMigration(["optmem", "/dest"], home).exitCode).toBe(0);
  expect(runMigration(["optmem", "--from", "/explicit", "/dest"], custom).exitCode).toBe(0);
  expect(source.binaryReads).toEqual(Object.keys(binaries));
});

test("CLI lists every project with its migratable page count, largest first, without opening the destination", (): void => {
  const root: string = "/home/test/.local/share/ai-memory/wiki";
  const source: FakeMigrationSource = new FakeMigrationSource({
    ...projectFiles(`${root}/space/p1`, "Empty", { "sessions/skip.md": "# Session" }),
    ...projectFiles(`${root}/space/p2`, "Populated", { "notes/one.md": "# One", "profile/stack/two.md": "# Two" }),
    ...projectFiles(`${root}/space/p3`, "One", { "notes/one.md": "# One", "index.md": "skip" }),
  });
  const io: FakeMigrationIO = new FakeMigrationIO(source);
  expect(runMigration(["ai-memory", "--list"], io)).toEqual({
    exitCode: 0,
    output: ["Populated\t2", "One\t1", "Empty\t0"],
  });
  expect(io.opened).toEqual([]);
  expect(io.target.writes).toEqual([]);
});

test("CLI rejects missing and ambiguous project names with useful candidates", (): void => {
  const source: FakeMigrationSource = new FakeMigrationSource({
    ...projectFiles(PROJECT, "Team", {}),
    ...projectFiles("/wiki/other/p", "Team", {}),
  });
  const io: FakeMigrationIO = new FakeMigrationIO(source);
  for (const [project, expected] of [
    ["Missing", "one of"],
    ["Team", "a unique project name"],
  ]) {
    const result: ReturnType<typeof runMigration> = runMigration(
      ["ai-memory", "--from", "/wiki", "--project", project ?? "", "/dest"],
      io,
    );
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).toContain(`received ${JSON.stringify(project)}, expected ${expected}`);
  }
  expect(io.opened).toEqual([]);
});

test("OptMem dry run prints creations, skipped records, warnings, and planned LOG lines without writing", (): void => {
  const io: FakeMigrationIO = withRecords(["#0 2026-11-19 First", "", "broken", "#3 2026-11-20 Last"]);
  const result: ReturnType<typeof runMigration> = runMigration(OPT_ARGS, io);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Dry run");
  expect(result.output).toContain("Create file: /dest/MEMORY.md");
  expect(result.output).toContain("Create file: /dest/LOG.md");
  expect(result.output).toContain("Append LOG.md: 2026-11-19 | event | First");
  expect(result.output).toContain("Append LOG.md: 2026-11-20 | event | Last");
  expect(result.output.join("\n")).toContain('record #2: received "broken"');
  expect(result.output.join("\n")).toContain("2 items skipped");
  expect(io.target.writes).toEqual([]);
  expect(io.target.files).toEqual({});
});

test("ai-memory dry run shows new pages and index lines with skips counted by reason", (): void => {
  const io: FakeMigrationIO = withProject({ "notes/one.md": "# One", "sessions/x.md": "# Past", "index.md": "Root" });
  const result: ReturnType<typeof runMigration> = runMigration(PROJECT_ARGS, io);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("Create file: /dest/one.md");
  expect(result.output).toContain("Index MEMORY.md: - [one](one.md) — One");
  expect(result.output.join("\n")).toContain("root file: 2");
  expect(result.output.join("\n")).toContain("folder sessions: 1");
  expect(io.target.writes).toEqual([]);
});

test("OptMem apply appends once, preserving existing LOG bytes and skipping duplicate lines", (): void => {
  const original: string = "2026-11-19 | event | Existing\r\n2026-11-19 | event | Last without newline";
  const destination: FakeMigrationDestination = new FakeMigrationDestination(
    { "MEMORY.md": markedIndex(), "LOG.md": original },
    original,
  );
  const io: FakeMigrationIO = withRecords(
    ["#0 2026-11-19 Existing", "#1 2026-11-20 New", "#2 2026-11-20 New"],
    destination,
  );
  const args: string[] = [...OPT_ARGS, "--apply"];
  expect(runMigration(args, io).output).toContain("ok: 0 memory files, MEMORY.md 1 lines, scope project");
  expect(destination.files["LOG.md"]).toBe(`${original}\n2026-11-20 | event | New\n`);
  expect(destination.files["MEMORY.md"]).toBe(markedIndex());
  const again: ReturnType<typeof runMigration> = runMigration(args, io);
  expect(again.exitCode).toBe(0);
  expect(again.output.join("\n")).toContain("0 LOG lines to append");
  expect(again.output.join("\n")).toContain("3 items skipped");
  expect(destination.writes).toHaveLength(1);
});

test("ai-memory apply writes the skeleton, indexes active pages only, and skips existing files on repeat", (): void => {
  const io: FakeMigrationIO = withProject({
    "notes/current.md": "---\ntitle: Current\n---\nBody",
    "notes/old.md": "---\nstatus: superseded\nsuperseded_by: notes/current.md\n---\nOld",
  });
  const args: string[] = [...PROJECT_ARGS, "--apply"];
  const first: ReturnType<typeof runMigration> = runMigration(args, io);
  expect(first.exitCode).toBe(0);
  expect(first.output).toContain("ok: 2 memory files, MEMORY.md 4 lines, scope project");
  expect(io.target.files["LOG.md"]).toStartWith("<!-- AAAA-MM-DD");
  expect(io.target.files["MEMORY.md"]).toContain("- [Current](current.md) — Current\n");
  expect(io.target.files["MEMORY.md"]).not.toContain("old.md");
  const snapshot: Record<string, string> = { ...io.target.files };
  const again: ReturnType<typeof runMigration> = runMigration(args, io);
  expect(again.exitCode).toBe(0);
  expect(again.output).toContain("Skip: current.md (already exists)");
  expect(again.output).toContain("Skip: old.md (already exists)");
  expect(io.target.writes).toHaveLength(1);
  expect(io.target.files).toEqual(snapshot);
});

test("apply runs the existing validator and exits 1 for log or index issues", (): void => {
  const cases: readonly (readonly [Record<string, string>, string])[] = [
    [{ "MEMORY.md": markedIndex(), "LOG.md": "invalid\n" }, "LOG.md:1: line format: received"],
    [{ "MEMORY.md": markedIndex("- [Missing](missing.md)\n") }, "MEMORY.md: link target: received"],
  ];
  for (const [files, issue] of cases) {
    const io: FakeMigrationIO = withRecords(["#0 2026-11-19 New"], new FakeMigrationDestination(files));
    const dry: ReturnType<typeof runMigration> = runMigration(OPT_ARGS, io);
    expect(dry.exitCode).toBe(0);
    const apply: ReturnType<typeof runMigration> = runMigration([...OPT_ARGS, "--apply"], io);
    expect(apply.exitCode).toBe(1);
    expect(apply.output.join("\n")).toContain(issue);
    expect(io.target.files["LOG.md"]).toContain("2026-11-19 | event | New");
  }
});

test("retries repair an unlinked file from this migration and preserve an unrelated same-name file", (): void => {
  const own: string = memory(
    "partial",
    'type: project\nkind: concept\norigin: "ai-memory:Team/notes/partial.md"',
    "Prior value",
  );
  const unrelated: string = memory("existing");
  const io: FakeMigrationIO = withProject(
    { "notes/partial.md": "# Current value", "notes/existing.md": "# Unrelated source" },
    new FakeMigrationDestination({
      "MEMORY.md": markedIndex("- [Existing](existing.md) — A fact\n"),
      "partial.md": own,
      "existing.md": unrelated,
    }),
  );
  const args: string[] = [...PROJECT_ARGS, "--apply"];
  const result: ReturnType<typeof runMigration> = runMigration(args, io);
  expect(result.exitCode).toBe(0);
  expect(io.target.files["partial.md"]).toBe(own);
  expect(io.target.files["existing.md"]).toBe(unrelated);
  expect(io.target.files["MEMORY.md"]).toBe(
    markedIndex("- [Existing](existing.md) — A fact\n- [partial](partial.md) — Prior value\n"),
  );
  expect(runMigration(args, io).exitCode).toBe(0);
  expect(io.target.writes).toHaveLength(1);
});

class FakeUnreadableOptSource extends FakeMigrationSource {
  override bytes(file: string): Uint8Array {
    const message: string = `Cannot read fixture ${file}`;
    throw new Error(message);
  }
}

test("reports the received OptMem LOG.txt path or read error when the log cannot be opened", (): void => {
  const cases: readonly (readonly [FakeMigrationSource, string])[] = [
    [new FakeMigrationSource({ "/opt/LOG.txt/child": "" }), 'received "/opt/LOG.txt"'],
    [new FakeUnreadableOptSource({ "/opt/LOG.txt": "" }), 'received "Cannot read fixture /opt/LOG.txt"'],
  ];
  for (const [source, received] of cases) {
    const io: FakeMigrationIO = new FakeMigrationIO(source);
    const result: ReturnType<typeof runMigration> = runMigration(OPT_ARGS, io);
    expect(result.exitCode).toBe(1);
    expect(result.output.join("\n")).toContain(`${received}, expected a readable 320-byte record log`);
    expect(io.opened).toEqual([]);
  }
});

test("ignores OptMem TREE and config whether or not LOG.txt has been created", (): void => {
  for (const record of [undefined, optRecord("#0 2026-11-19 Event")]) {
    const io: FakeMigrationIO = new FakeMigrationIO(
      new FakeMigrationSource(
        { "/opt/TREE/320": "ignored", "/opt/config": "ignored" },
        record === undefined ? {} : { "/opt/LOG.txt": record },
      ),
    );
    expect(runMigration(OPT_ARGS, io).exitCode).toBe(0);
    expect(io.source.reads).toEqual([]);
    expect(io.source.binaryReads).toEqual(record === undefined ? [] : ["/opt/LOG.txt"]);
  }
});

test("applying twice indexes a truncated inline-code title exactly once and passes validation", (): void => {
  const title: string = "Para posts novos, use `teams_send_channel_message` com o assunto no campo `subje";
  const file: string = "teams-send-channel.md";
  const io: FakeMigrationIO = withProject({
    [`profile/${file}`]: `---\ntitle: ${JSON.stringify(title)}\n---\n# Body\n`,
  });
  const args: string[] = [...PROJECT_ARGS, "--apply"];
  for (let run: number = 0; run < 2; run++) {
    const result: ReturnType<typeof runMigration> = runMigration(args, io);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("ok: 1 memory files, MEMORY.md 4 lines, scope project");
    const lines: string[] = (io.target.files["MEMORY.md"] ?? "").split("\n");
    expect(lines.filter((line: string): boolean => line.includes(`](${file})`))).toHaveLength(1);
  }
  expect(io.target.writes).toHaveLength(1);
});
