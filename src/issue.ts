export interface Issue {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

function showValue(value: unknown): string {
  if (value === undefined) return "missing";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(Bun.inspect(value, { depth: 2 }));
  }
}

export function receivedIssue(file: string, field: string, value: unknown, expected: string): Issue {
  return {
    file,
    message: field + ": received " + showValue(value) + ", expected " + expected,
  };
}
