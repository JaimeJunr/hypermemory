import { expect, test } from "bun:test";
import {
  applyEdit,
  copyTargets,
  expandVariables,
  mentionsPersonal,
  readMetadata,
  redirectTargets,
  scopeFromIndex,
} from "../mod/hooks/scope-rules";

test("scopeFromIndex reads only line two, with LF or CRLF", (): void => {
  expect(scopeFromIndex("<!-- hypermemory-format: 1 -->\r\n<!-- hypermemory-scope: shared -->\r\n")).toBe("shared");
  expect(scopeFromIndex("<!-- hypermemory-scope: shared -->\n")).toBeUndefined();
});

test("readMetadata keeps quoted values marked and ignores comments and other keys", (): void => {
  const metadata = readMetadata('---\nname: x\nmetadata:\n  type: "user" # gosto\n  personal: true\nother: 1\n---\n');
  expect([...metadata]).toEqual([
    ["type", '"user"'],
    ["personal", "true"],
  ]);
  expect([...readMetadata("no frontmatter")]).toEqual([]);
});

test("applyEdit replaces the first match or every match", (): void => {
  expect(applyEdit("a a", "a", "$&b", false)).toBe("$&b a");
  expect(applyEdit("a a", "a", "b", true)).toBe("b b");
});

test("expandVariables resolves assignments made in the same command and keeps unknown ones", (): void => {
  expect(expandVariables(`S=/repo; export D="/m m" && echo "$S/\${D}/$HOME"`)).toBe(
    `S=/repo; export D="/m m" && echo "/repo//m m/$HOME"`,
  );
});

test("redirectTargets needs a personal field in the command and resolves relative paths", (): void => {
  expect(redirectTargets("printf 'type: user' > memory/a.md >> './b.md' | tee -a /x/c.md", "/repo")).toEqual([
    "/repo/memory/a.md",
    "/repo/b.md",
    "/x/c.md",
  ]);
  expect(redirectTargets("echo hi > memory/a.md", "/repo")).toEqual([]);
  expect(mentionsPersonal("kind: 'profile'")).toBe(true);
});

test("copyTargets maps each .md source to its destination file or folder", (): void => {
  expect(copyTargets("cp -f a.md /tmp/b.md /dest/ && mv c.md d.md", "/repo")).toEqual([
    { source: "/repo/a.md", destination: "/dest/a.md" },
    { source: "/tmp/b.md", destination: "/dest/b.md" },
    { source: "/repo/c.md", destination: "/repo/d.md" },
  ]);
  expect(copyTargets("cp notes.txt /dest/", "/repo")).toEqual([]);
});
