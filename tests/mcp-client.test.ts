import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  callMcpTool,
  closeAllMcpConnections,
  isConnectableMcpServer,
  listMcpTools,
  setMcpTransportFactory
} from "../lib/execution/mcp-client";

// Stand up an in-process MCP server with two tools and link it to the client via
// an in-memory transport — the real client code path, no child process.
async function linkFakeServer() {
  const server = new McpServer({ name: "fake-gmail", version: "1.0.0" });
  server.registerTool(
    "create_draft",
    { description: "Create a draft", inputSchema: { to: z.string(), subject: z.string(), body: z.string() } },
    async ({ to, subject }) => ({ content: [{ type: "text", text: `draft for ${to} re ${subject}` }] })
  );
  server.registerTool(
    "send_email",
    { description: "Send an email", inputSchema: { to: z.string(), subject: z.string(), body: z.string() } },
    async ({ to }) => ({ content: [{ type: "text", text: `sent to ${to}` }] })
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  setMcpTransportFactory(() => clientTransport);
}

describe("governed MCP client — discovery + invocation over the real protocol", () => {
  afterEach(async () => {
    await closeAllMcpConnections();
    setMcpTransportFactory(null);
  });

  it("only registered first-party servers are connectable (resolved from data)", async () => {
    expect(await isConnectableMcpServer("gmail")).toBe(true);
    expect(await isConnectableMcpServer("evil.example.com")).toBe(false);
    expect(await isConnectableMcpServer("stripe")).toBe(false);
  });

  it("lists a server's tools with their JSON input schemas (tools/list)", async () => {
    await linkFakeServer();
    const tools = await listMcpTools("gmail");
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["create_draft", "send_email"]);

    const draft = tools.find((t) => t.name === "create_draft");
    expect(draft?.inputSchema).toBeTruthy();
    // The discovered schema describes the structured arguments the tool expects.
    expect(JSON.stringify(draft?.inputSchema)).toContain("subject");
  });

  it("calls a tool by name with structured arguments (tools/call)", async () => {
    await linkFakeServer();
    const result = await callMcpTool("gmail", "create_draft", {
      to: "a@example.com",
      subject: "Hi",
      body: "Hello"
    });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("draft for a@example.com re Hi");
  });

  it("refuses to connect a non-allowlisted server", async () => {
    await expect(listMcpTools("evil.example.com")).rejects.toThrow(/not registered/);
  });
});
