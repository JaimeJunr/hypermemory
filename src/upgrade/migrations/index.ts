import { migration as addFormatMarker } from "./0001-add-format-marker";

export interface FormatMigration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  apply(files: ReadonlyMap<string, string>): ReadonlyMap<string, string>;
}

export interface RegisteredMigration {
  readonly id: string;
  readonly migration: FormatMigration;
}

export const FORMAT_MIGRATIONS: readonly RegisteredMigration[] = [
  { id: "0001-add-format-marker", migration: addFormatMarker },
];
