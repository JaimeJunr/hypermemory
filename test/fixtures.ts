import { CURRENT_FORMAT, formatMarker } from "../src/format";
import type { MemoryReader, PreviousLogReader, ValidationResult } from "../src/validator";
import { validateMemory } from "../src/validator";

export class FakeMemoryReader implements MemoryReader {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  list(): readonly string[] {
    return Object.keys(this.files).filter((file: string): boolean => !file.includes("/"));
  }

  nested(): readonly string[] {
    return Object.keys(this.files).filter((file: string): boolean => file.includes("/"));
  }

  read(file: string): string {
    const content: string | undefined = this.files[file];
    if (content === undefined) throw new Error(`Missing fixture: ${file}`);
    return content;
  }
}

export class FakePreviousLogReader implements PreviousLogReader {
  constructor(private readonly content?: string) {}

  read(): string | undefined {
    return this.content;
  }
}

export function markedIndex(content: string = "", newline: string = "\n"): string {
  return formatMarker(CURRENT_FORMAT) + newline + content;
}

export function check(files: Readonly<Record<string, string>>, previousLog?: string): ValidationResult {
  const reader: FakeMemoryReader = new FakeMemoryReader({
    "LOG.md": "",
    ...files,
    "MEMORY.md": markedIndex(files["MEMORY.md"]),
  });
  return validateMemory(reader, new FakePreviousLogReader(previousLog));
}

export function memory(name: string, metadata: string = "type: project", description: string = "A fact"): string {
  const fields: string = metadata
    .split("\n")
    .map((field: string): string => `  ${field}`)
    .join("\n");
  return ["---", `name: ${name}`, `description: ${description}`, "metadata:", fields, "---", "", "Body"].join("\n");
}
