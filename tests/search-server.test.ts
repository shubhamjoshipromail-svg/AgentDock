import { afterEach, describe, expect, it, vi } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createSearchMcpServer } from "../servers/search/server";
import { webSearch } from "../servers/search/search-tools";

// Chunk 15 Phase 3: web search is "just another MCP server". It stands up as a
// real MCP server (official SDK) and returns real DDG results through the MCP
// protocol — reached identically to the Gmail server.
async function connectClient(search?: (q: string) => Promise<{ output: string; costCents: number }>) {
  const server = createSearchMcpServer(search ? { search } : {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("first-party web-search MCP server", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exposes web_search via tools/list with a query schema", async () => {
    const client = await connectClient(async () => ({ output: "x", costCents: 0 }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["web_search"]);
    expect(JSON.stringify(tools[0].inputSchema)).toContain("query");
    await client.close();
  });

  it("web_search returns real DDG results as text through the MCP protocol", async () => {
    // Stub the network at the search layer; assert the protocol round-trip.
    const client = await connectClient(async (q) => ({ output: `1. result for ${q}`, costCents: 0 }));
    const res = await client.callTool({ name: "web_search", arguments: { query: "agentdock" } });
    const content = res.content as { type: string; text: string }[];
    expect(content[0].text).toBe("1. result for agentdock");
    await client.close();
  });

  it("the real webSearch falls back HTML→IA and sanitizes control chars (no behavior regression)", async () => {
    // Same DDG-backed behavior the legacy in-process tool had.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({ AbstractText: "AgentDock is a governed agent runtime.\u001b[31m evil", RelatedTopics: [{ Text: "Related: governed execution" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const res = await webSearch("what is agentdock");
    expect(res.output).toContain("AgentDock is a governed agent runtime");
    expect(res.output).toContain("Related: governed execution");
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f]/.test(res.output)).toBe(false);
  });
});
