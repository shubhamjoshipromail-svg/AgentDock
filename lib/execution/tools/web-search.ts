import type { ToolExecution } from "./registry";

// Phase D: a stub. Phase E replaces this with a REAL read-only web search.
// Output is returned as untrusted data by the caller (tagged + delimited); it is
// never executed as instructions. No writes, no auth, no PII egress.
export async function webSearch(query: string): Promise<ToolExecution> {
  const trimmed = query.slice(0, 400);
  return {
    output: `Search results for "${trimmed}": [stubbed in Phase D — Phase E performs a real read-only search].`,
    costCents: 1
  };
}
