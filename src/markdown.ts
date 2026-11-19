export function markdownLines(content: string): string[] {
  const lines: string[] = content.split(/\r\n|[\r\n]/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function appendLines(content: string, lines: readonly string[]): string {
  if (lines.length === 0) return content;
  const separator: string = content === "" || /[\r\n]$/.test(content) ? "" : "\n";
  return `${content}${separator}${lines.join("\n")}\n`;
}
