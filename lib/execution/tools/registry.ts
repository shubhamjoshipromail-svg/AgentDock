import { webSearch } from "./web-search";

export type ToolExecution = { output: string; costCents: number };
export type ToolExecutor = (input: string) => Promise<ToolExecution>;

// The ONLY real-execution registry. It contains web-search and nothing else, so
// no other tool can reach real execution in this chunk — keyed by McpServer.name.
// Any "allowed" tool call whose server is not here is recorded as gated-but-not-
// executed (simulated), never a real side effect.
const EXECUTOR_REGISTRY: Record<string, ToolExecutor> = {
  "search-mcp": webSearch
};

export function getExecutor(serverName: string): ToolExecutor | null {
  return EXECUTOR_REGISTRY[serverName] ?? null;
}

export function isRealTool(serverName: string): boolean {
  return serverName in EXECUTOR_REGISTRY;
}
