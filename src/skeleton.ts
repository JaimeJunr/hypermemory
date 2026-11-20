import { readFileSync } from "node:fs";
import { insertScopeMarker, type MemoryScope } from "./format";

export interface Skeleton {
  readonly memory: string;
  readonly log: string;
}

export function readSkeleton(): Skeleton {
  const memory: string = readFileSync(new URL("../memory/MEMORY.md", import.meta.url), "utf8");
  const log: string = readFileSync(new URL("../memory/LOG.md", import.meta.url), "utf8");
  return { memory, log };
}

export function scopedSkeleton(skeleton: Skeleton, scope: MemoryScope): Skeleton {
  return { ...skeleton, memory: insertScopeMarker(skeleton.memory, scope) };
}
