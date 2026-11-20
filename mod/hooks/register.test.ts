import { expect, test } from "claude-code/testing";

const PERSONAL =
  "---\nname: gosto-bun\ndescription: prefere Bun\nmetadata:\n  type: user\n  kind: profile\n---\nPrefere Bun.\n";
const PROJECT =
  "---\nname: deploy\ndescription: deploy\nmetadata:\n  type: project\n  kind: decision\n---\nDeploy às 14h.\n";
const index = (scope: string): string => `<!-- hypermemory-format: 1 -->\n<!-- hypermemory-scope: ${scope} -->\n`;

test("memória pessoal numa pasta shared é barrada", async ($, on) => {
  on("fs.read", () => ({ value: index("shared") }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Write", file_path: "/repo/memory/gosto-bun.md", content: PERSONAL });
  expect(result.deny).toMatch(/hypermemory\//);
});

test("memória pessoal numa pasta de projeto passa", async ($, on) => {
  on("fs.read", () => ({ value: index("project") }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Write", file_path: "/repo/memory/gosto-bun.md", content: PERSONAL });
  expect(result.deny).toBeUndefined();
});

test("fato de projeto numa pasta shared passa", async ($, on) => {
  on("fs.read", () => ({ value: index("shared") }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Write", file_path: "/repo/memory/deploy.md", content: PROJECT });
  expect(result.deny).toBeUndefined();
});

test("edição que torna a memória pessoal numa pasta shared é barrada", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared"), "/repo/memory/deploy.md": PROJECT }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({
    tool: "Edit",
    file_path: "/repo/memory/deploy.md",
    old_string: "  type: project",
    new_string: "  type: user",
  });
  expect(result.deny).toMatch(/hypermemory\//);
});

test("pasta sem MEMORY.md não barra nada", async ($, on) => {
  on("fs.read", () => {
    throw new Error("ENOENT");
  });
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Write", file_path: "/repo/notes/gosto.md", content: PERSONAL });
  expect(result.deny).toBeUndefined();
});

// Só /repo/memory tem MEMORY.md; o resto do disco não existe.
function disk(files: Record<string, string>): (_: unknown, e: { path: string }) => { value: string } {
  return (_, e) => {
    const value: string | undefined = files[e.path];
    if (value === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value };
  };
}

test("memória pessoal numa subpasta de uma memória shared é barrada", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared") }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Write", file_path: "/repo/memory/archive/gosto.md", content: PERSONAL });
  expect(result.deny).toMatch(/hypermemory\//);
});

test("Bash que redireciona memória pessoal para uma pasta shared é barrado", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared") }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("tool.call", () => ({ result: {} }));
  const command = "printf -- '---\\nname: g\\nmetadata:\\n  type: user\\n---\\n' > memory/gosto.md";
  const result = await $.tool.call({ tool: "Bash", command });
  expect(result.deny).toMatch(/hypermemory\//);
});

test("Bash que copia arquivo pessoal para uma pasta shared é barrado", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared"), "/tmp/gosto.md": PERSONAL }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({ tool: "Bash", command: "cp /tmp/gosto.md /repo/memory/" });
  expect(result.deny).toMatch(/hypermemory\//);
});

test("Bash com fato de projeto ou sem gravar em .md passa", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared"), "/tmp/deploy.md": PROJECT }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("tool.call", () => ({ result: {} }));
  for (const command of [
    "cp /tmp/deploy.md memory/deploy.md",
    'grep "type: user" memory/*.md',
    'echo "type: user" > /tmp/x.txt',
  ]) {
    const result = await $.tool.call({ tool: "Bash", command });
    expect(result.deny).toBeUndefined();
  }
});

test("Bash que grava por variável definida no próprio comando é barrado", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared") }));
  on("session.cwd", () => ({ value: "/tmp" }));
  on("tool.call", () => ({ result: {} }));
  for (const command of [
    `S=/repo; printf 'type: user\\n' > "$S/memory/g.md"`,
    `export D="/repo/memory" && printf 'kind: profile\\n' | tee -a \${D}/g.md`,
  ]) {
    const result = await $.tool.call({ tool: "Bash", command });
    expect(result.deny).toMatch(/hypermemory\//);
  }
});

test("edição só do corpo de um fato de projeto numa pasta shared passa", async ($, on) => {
  on("fs.read", disk({ "/repo/memory/MEMORY.md": index("shared"), "/repo/memory/deploy.md": PROJECT }));
  on("tool.call", () => ({ result: {} }));
  const result = await $.tool.call({
    tool: "Edit",
    file_path: "/repo/memory/deploy.md",
    old_string: "Deploy às 14h.",
    new_string: "Deploy às 15h; o time prefere a tarde (type: user não é campo aqui).",
  });
  expect(result.deny).toBeUndefined();
});
