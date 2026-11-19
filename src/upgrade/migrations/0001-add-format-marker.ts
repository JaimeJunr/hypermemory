import { formatMarker, MEMORY_INDEX } from "../../format";
import type { FormatMigration } from "./index";

export const migration: FormatMigration = {
  from: 0,
  to: 1,
  description: "Add the format-1 marker to MEMORY.md",
  apply(files: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
    const index: string = files.get(MEMORY_INDEX) ?? "";
    const ending: string = /\r\n|[\r\n]/.exec(index)?.[0] ?? "\n";
    const upgraded: Map<string, string> = new Map(files);
    upgraded.set(MEMORY_INDEX, formatMarker(1) + ending + index);
    return upgraded;
  },
};
