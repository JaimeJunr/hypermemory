import { dirname, relative } from "node:path";
import type { MigrationDestination, MigrationIO, MigrationSource } from "../src/migrate";
import type { FileChange, Skeleton } from "../src/migration/plan";
import { FakeMemoryReader, FakePreviousLogReader } from "./fixtures";
import type { WikiEntry, WikiReader } from "../src/migration/wiki";

export class FakeWikiReader implements WikiReader {
  readonly reads: string[] = [];

  constructor(protected readonly files: Record<string, string>) {}

  entries(directory: string): readonly WikiEntry[] | undefined {
    const children: Map<string, WikiEntry> = new Map();
    for (const file of Object.keys(this.files)) {
      const path: string = relative(directory, file);
      if (path === "" || path === ".." || path.startsWith("../")) continue;
      const [name = "", ...rest]: string[] = path.split("/");
      children.set(name, { name, directory: rest.length > 0 });
    }
    return children.size === 0 ? undefined : [...children.values()];
  }

  read(file: string): string {
    this.reads.push(file);
    const content: string | undefined = this.files[file];
    if (content === undefined) throw new Error("Expected a fixture file, received " + file);
    return content;
  }
}

export function projectFiles(directory: string, name: string, pages: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = {
    [dirname(directory) + "/_meta.md"]: "---\nworkspace: Test space\n---\n",
    [directory + "/_meta.md"]: "---\nproject: " + JSON.stringify(name) + "\n---\n",
  };
  for (const [path, content] of Object.entries(pages)) files[directory + "/" + path] = content;
  return files;
}

export class FakeMigrationSource extends FakeWikiReader implements MigrationSource {
  readonly binaryReads: string[] = [];

  constructor(
    files: Record<string, string> = {},
    private readonly binaries: Readonly<Record<string, Uint8Array>> = {},
  ) {
    super({ ...Object.fromEntries(Object.keys(binaries).map((file: string): [string, string] => [file, ""])), ...files });
  }

  bytes(file: string): Uint8Array {
    this.binaryReads.push(file);
    const content: Uint8Array | undefined = this.binaries[file];
    if (content === undefined) throw new Error("Expected a binary fixture, received " + file);
    return content;
  }
}

export class FakeMigrationDestination implements MigrationDestination {
  readonly writes: FileChange[][] = [];
  readonly reader: FakeMemoryReader;
  readonly previousLog: FakePreviousLogReader;

  constructor(readonly files: Record<string, string> = {}, previousLog?: string) {
    this.reader = new FakeMemoryReader(files);
    this.previousLog = new FakePreviousLogReader(previousLog);
  }

  apply(changes: readonly FileChange[]): void {
    this.writes.push([...changes]);
    for (const { file, content } of changes) this.files[file] = content;
  }
}

export class FakeMigrationIO implements MigrationIO {
  readonly home: string = "/home/test";
  readonly skeleton: Skeleton = { memory: "<!-- Índice Hypermemory: teste -->\n", log: "<!-- AAAA-MM-DD | kind | texto -->\n" };
  readonly opened: string[][] = [];

  constructor(
    readonly source: FakeMigrationSource,
    readonly target: FakeMigrationDestination = new FakeMigrationDestination(),
    readonly memoryDir?: string,
  ) {}

  destination(directory: string, source: string): MigrationDestination {
    this.opened.push([directory, source]);
    return this.target;
  }
}

export function optRecord(value: string, padding: number = 32): Buffer {
  const bytes: Buffer = Buffer.alloc(320, padding);
  bytes.write(value, "utf8");
  bytes[319] = 10;
  return bytes;
}
