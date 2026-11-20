import type { Register } from "claude-code";
import {
  applyEdit,
  copyTargets,
  dirOf,
  expandVariables,
  isPersonalContent,
  mentionsPersonal,
  redirectTargets,
  scopeFromIndex,
} from "./scope-rules";
import { registerSessionHooks } from "./session-hooks";

const PERSONAL_DIR: string = "~/.claude/hypermemory/";

type ReadText = (path: string) => Promise<string>;

async function readOrUndefined(read: ReadText, path: string): Promise<string | undefined> {
  try {
    return await read(path);
  } catch {
    return undefined;
  }
}

// Sobe as pastas até o primeiro MEMORY.md: memória em subpasta (ex.: archive/) herda o escopo da pasta-mãe.
async function scopeOf(read: ReadText, dir: string): Promise<string | undefined> {
  for (let current: string = dir; current !== ""; current = dirOf(current)) {
    const index: string | undefined = await readOrUndefined(read, `${current}/MEMORY.md`);
    if (index !== undefined) return scopeFromIndex(index);
  }
  return undefined;
}

async function isShared(read: ReadText, filePath: string): Promise<boolean> {
  return filePath.endsWith(".md") && (await scopeOf(read, dirOf(filePath))) === "shared";
}

function denial(plugin: string, filePath: string): string {
  return `${plugin}: ${filePath} fica numa memória compartilhada (hypermemory-scope: shared). Memória pessoal (type user, kind profile, personal: true) vai para ${PERSONAL_DIR}, no mesmo formato.`;
}

// Julga o arquivo como ficaria depois do Edit; sem ler o arquivo, cai na checagem solta do trecho novo.
async function editedIsPersonal(
  read: ReadText,
  e: { file_path: string; old_string: string; new_string: string; replace_all?: boolean },
): Promise<boolean> {
  const current: string | undefined = await readOrUndefined(read, e.file_path);
  if (current === undefined) return mentionsPersonal(e.new_string);
  return isPersonalContent(applyEdit(current, e.old_string, e.new_string, e.replace_all === true));
}

async function bashTarget(read: ReadText, command: string, cwd: string): Promise<string | undefined> {
  const targets: string[] = redirectTargets(command, cwd);
  for (const { source, destination } of copyTargets(command, cwd)) {
    if (isPersonalContent((await readOrUndefined(read, source)) ?? "")) targets.push(destination);
  }
  for (const target of targets) if (await isShared(read, target)) return target;
  return undefined;
}

export const register: Register = (on) => {
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const read: ReadText = (path: string): Promise<string> => $.fs.read(path);
    const blocked: boolean = isPersonalContent(e.content) && (await isShared(read, e.file_path));
    return blocked ? { deny: denial($.plugin.name, e.file_path) } : next(e);
  }).catch((_$, e, next) => next(e)); // falha do guarda não trava a gravação; o validador ainda pega

  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const read: ReadText = (path: string): Promise<string> => $.fs.read(path);
    const blocked: boolean = (await isShared(read, e.file_path)) && (await editedIsPersonal(read, e));
    return blocked ? { deny: denial($.plugin.name, e.file_path) } : next(e);
  }).catch((_$, e, next) => next(e)); // falha do guarda não trava a gravação; o validador ainda pega

  // Cobre redirecionamento, tee e cp/mv/install; script indireto ou variável de fora fica com o validador.
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!e.command.includes(".md")) return next(e);
    const read: ReadText = (path: string): Promise<string> => $.fs.read(path);
    const blocked: string | undefined = await bashTarget(read, expandVariables(e.command), await $.session.cwd());
    return blocked === undefined ? next(e) : { deny: denial($.plugin.name, blocked) };
  }).catch((_$, e, next) => next(e)); // falha do guarda não trava o comando; o validador ainda pega

  registerSessionHooks(on);
};
