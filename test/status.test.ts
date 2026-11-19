import { expect, test } from "bun:test";
import { check, memory } from "./fixtures";

test("supersede matches another memory's frontmatter name independently of its filename", (): void => {
  expect(
    check({
      "MEMORY.md": "[Current](new-file.md)",
      "new-file.md": memory("current"),
      "old.md": memory("old", "type: project\nstatus: superseded\nsuperseded_by: current"),
    }).issues,
  ).toEqual([]);
});

test("supersede rejects missing, self, filename-only, and reserved index targets", (): void => {
  expect(
    check({
      "MEMORY.md": "[Target](target.md)",
      "index-domain.md": memory("index-target"),
      "target.md": memory("valid-target"),
      "a.md": memory("a", "type: project\nstatus: superseded"),
      "b.md": memory("b", "type: project\nstatus: superseded\nsuperseded_by: b"),
      "c.md": memory("c", "type: project\nstatus: superseded\nsuperseded_by: target"),
      "d.md": memory("d", "type: project\nstatus: superseded\nsuperseded_by: index-target"),
    }).issues,
  ).toEqual([
    {
      file: "a.md",
      message: "metadata.superseded_by: received missing, expected the name of another existing memory file",
    },
    {
      file: "b.md",
      message: 'metadata.superseded_by: received "b", expected the name of another existing memory file',
    },
    {
      file: "c.md",
      message: 'metadata.superseded_by: received "target", expected the name of another existing memory file',
    },
    {
      file: "d.md",
      message: 'metadata.superseded_by: received "index-target", expected the name of another existing memory file',
    },
  ]);
});

test("session handoffs accept open, claimed with an owner, and superseded statuses", (): void => {
  expect(
    check({
      "MEMORY.md": "[Open](open.md) [Claimed](claimed.md) [Ordinary](ordinary.md)",
      "open.md": memory("open", "type: project\nkind: session\nstatus: open\nclaimed_by:"),
      "claimed.md": memory("claimed", "type: project\nkind: session\nstatus: claimed\nclaimed_by: Agent A"),
      "superseded.md": memory("old", "type: project\nkind: session\nstatus: superseded\nsuperseded_by: open"),
      "ordinary.md": memory("ordinary", "type: project\nkind: decision\nstatus: claimed"),
    }).issues,
  ).toEqual([]);
});

test("session handoffs reject missing or unknown status and missing or blank claimed_by", (): void => {
  const fields: string = "type: project\nkind: session";
  expect(
    check({
      "MEMORY.md": "[A](a.md) [B](b.md) [C](c.md) [D](d.md)",
      "a.md": memory("a", fields),
      "b.md": memory("b", `${fields}\nstatus: closed`),
      "c.md": memory("c", `${fields}\nstatus: claimed`),
      "d.md": memory("d", `${fields}\nstatus: claimed\nclaimed_by: "  "`),
    }).issues,
  ).toEqual([
    {
      file: "a.md",
      message: "metadata.status: received missing, expected one of open|claimed|superseded for metadata.kind session",
    },
    {
      file: "b.md",
      message: 'metadata.status: received "closed", expected one of open|claimed|superseded for metadata.kind session',
    },
    { file: "c.md", message: "metadata.claimed_by: received missing, expected a non-empty string" },
    { file: "d.md", message: 'metadata.claimed_by: received "  ", expected a non-empty string' },
  ]);
});
