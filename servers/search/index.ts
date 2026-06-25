import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createSearchMcpServer } from "./server";

// Entry point for the first-party web-search MCP server, spawned over stdio by
// the governed client — reached identically to any other MCP server. Read-only:
// it needs no credential, so the broker injects nothing into its environment.
async function main() {
  const server = createSearchMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[search-mcp] fatal:", error);
  process.exit(1);
});
