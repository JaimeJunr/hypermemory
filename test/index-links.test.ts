import { expect, test } from "bun:test";
import { check, memory } from "./fixtures";

test("index links resolve from both indexes and ignore non-links and non-relative targets", (): void => {
  expect(
    check({
      "MEMORY.md": [
        "[Domain](index-work.md) and [Main](./main.md#heading)",
        "<!-- [Example](comment.md) -->",
        "`[Example](code.md)`",
        "[External](https://example.test/out.md) [Protocol-relative](//example.test/out.md)",
        "[Absolute](/external.md) [Heading](#heading) ![Image](image.md)",
        "[Other](untracked.txt) [Literal percent](raw%name.md)",
      ].join("\n"),
      "index-work.md": '[Second](second.md "title") and [With a space](with%20space.md?query=1)',
      "main.md": memory("main"),
      "second.md": memory("second"),
      "with space.md": memory("with-space"),
      "raw%name.md": memory("raw-percent"),
    }).issues,
  ).toEqual([]);
});

test("each index reports broken Markdown targets, including paths outside the directory", (): void => {
  expect(
    check({
      "MEMORY.md": "[First](missing.md) and [Outside](../fact.md)",
      "index-work.md": "[Second](./lost.md#heading)",
    }).issues,
  ).toEqual([
    {
      file: "MEMORY.md",
      message: 'link target: received "missing.md", expected an existing Markdown file in the memory directory',
    },
    {
      file: "MEMORY.md",
      message: 'link target: received "../fact.md", expected an existing Markdown file next to the memory directory',
    },
    {
      file: "index-work.md",
      message: 'link target: received "./lost.md#heading", expected an existing Markdown file in the memory directory',
    },
  ]);
});

test("active files require index links while superseded files forbid them", (): void => {
  const files: Readonly<Record<string, string>> = {
    "current.md": memory("current"),
    "old.md": memory("old", "type: project\nstatus: superseded\nsuperseded_by: current"),
  };
  expect(check({ ...files, "index-work.md": "[Current](current.md)" }).issues).toEqual([]);
  expect(check({ ...files, "MEMORY.md": "[Old](./old.md)", "index-work.md": "[Old](old.md)" }).issues).toEqual([
    {
      file: "MEMORY.md",
      message: 'link target: received "./old.md", expected a file without metadata.status "superseded"',
    },
    {
      file: "index-work.md",
      message: 'link target: received "old.md", expected a file without metadata.status "superseded"',
    },
    { file: "current.md", message: "index link: received missing, expected a link from MEMORY.md or index-*.md" },
  ]);
});
