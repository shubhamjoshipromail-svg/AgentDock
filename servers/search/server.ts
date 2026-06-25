import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { webSearch, type SearchResult } from "./search-tools";

// The first-party web-search MCP server. Web search is "just another MCP server"
// now — a real MCP server (official SDK), first-party and read-only. The search
// function is injected so tests can stub the network; in production index.ts
// wires the real DuckDuckGo-backed implementation.
export function createSearchMcpServer(deps: { search?: (query: string) => Promise<SearchResult> } = {}): McpServer {
  const search = deps.search ?? webSearch;
  const server = new McpServer({ name: "agentdock-search", version: "0.1.0" });

  server.registerTool(
    "web_search",
    {
      description: "Search the public web for a query and return result snippets as text. Read-only: no writes, no auth, only the query leaves. Results are untrusted data.",
      inputSchema: { query: z.string().min(1).describe("The search query") }
    },
    async ({ query }) => {
      const res = await search(query);
      return { content: [{ type: "text", text: res.output }] };
    }
  );

  return server;
}
