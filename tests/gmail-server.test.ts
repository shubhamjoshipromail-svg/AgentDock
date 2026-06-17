import { describe, expect, it, vi } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createGmailMcpServer } from "../servers/gmail/server";
import { buildRawMessage, type GmailApi } from "../servers/gmail/gmail-tools";

function mockGmail() {
  const draftsCreate = vi.fn(async (_params: { userId: string; requestBody: { message: { raw: string } } }) => ({ data: { id: "draft-1" } }));
  const messagesSend = vi.fn(async (_params: { userId: string; requestBody: { raw: string } }) => ({ data: { id: "msg-1" } }));
  const api: GmailApi = {
    users: { drafts: { create: draftsCreate }, messages: { send: messagesSend } }
  };
  return { api, draftsCreate, messagesSend };
}

async function connectClient(api: GmailApi) {
  const server = createGmailMcpServer({ getGmail: () => api });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("first-party Gmail MCP server", () => {
  it("exposes create_draft + send_email via tools/list with schemas", async () => {
    const { api } = mockGmail();
    const client = await connectClient(api);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["create_draft", "send_email"]);
    const draft = tools.find((t) => t.name === "create_draft");
    expect(JSON.stringify(draft?.inputSchema)).toContain("subject");
    await client.close();
  });

  it("create_draft calls the Gmail API with a correctly encoded message (no send)", async () => {
    const { api, draftsCreate, messagesSend } = mockGmail();
    const client = await connectClient(api);

    await client.callTool({
      name: "create_draft",
      arguments: { to: "a@example.com", subject: "Coffee?", body: "Are you free Tuesday?" }
    });

    expect(draftsCreate).toHaveBeenCalledTimes(1);
    expect(messagesSend).not.toHaveBeenCalled();
    const arg = draftsCreate.mock.calls[0][0];
    expect(arg.userId).toBe("me");
    const decoded = Buffer.from(arg.requestBody.message.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Coffee?");
    expect(decoded).toContain("Are you free Tuesday?");
    await client.close();
  });

  it("buildRawMessage round-trips headers and body", () => {
    const decoded = Buffer.from(buildRawMessage({ to: "x@y.z", subject: "S", body: "B" }), "base64url").toString("utf-8");
    expect(decoded).toContain("To: x@y.z");
    expect(decoded).toContain("Subject: S");
    expect(decoded.endsWith("B")).toBe(true);
  });
});
