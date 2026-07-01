// Single source of truth for terminal run statuses. Both the SSE stream (server)
// and the workspace (client) derive "is this run over?" from here — never from a
// hardcoded list copied into a component, so a new terminal status can never
// leave the UI spinning forever.
export const TERMINAL_RUN_STATUSES = [
  "completed",
  "halted_error",
  "halted_cost",
  "killed"
] as const;

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_SET.has(status);
}
