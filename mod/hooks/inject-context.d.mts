// Tipos do hook de comando em JavaScript puro (inject-context.mjs), para os testes e o tsc.
export interface HookInput {
  readonly hook_event_name: string;
  readonly session_id: string;
  readonly cwd: string;
  readonly source?: string;
}

export function summaryPath(home: string, cwd: string, sessionId: string): string;
export function contextFor(input: HookInput, home: string): string | undefined;
export function answer(raw: string, home: string): string;
