import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Mock the MCP client so connect + discover don't try to spawn real processes.
const mcpClient = vi.hoisted(() => ({
  connectCalls: 0,
  listToolsCalls: 0,
  toThrow: null as Error | null,
  tools: [
    { name: "send_email", description: "Send an email", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } } },
    { name: "create_draft", description: "Create a draft", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } } }
  ]
}));

// Mock the credential broker so connect doesn't require real OAuth tokens.
vi.mock("../lib/execution/credential-broker", () => ({
  loadBrokeredCredential: vi.fn(async () => "mock-oauth-token"),
  hasCredentialBroker: vi.fn(() => true)
}));

vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    getClient: vi.fn(async () => {
      mcpClient.connectCalls += 1;
      if (mcpClient.toThrow) throw mcpClient.toThrow;
      return {}; // mock client
    }),
    closeMcpConnection: vi.fn(async () => { }),
    listMcpTools: vi.fn(async () => {
      if (mcpClient.toThrow) throw mcpClient.toThrow;
      mcpClient.listToolsCalls += 1;
      return mcpClient.tools;
    }),
    callMcpTool: actual.callMcpTool,
    isConnectableMcpServer: actual.isConnectableMcpServer,
    mcpTokenEnvVar: actual.mcpTokenEnvVar,
    setMcpTransportFactory: actual.setMcpTransportFactory
  };
});

import { getClient, closeMcpConnection, listMcpTools } from "../lib/execution/mcp-client";

const getClientMock = vi.mocked(getClient);
const closeMcpMock = vi.mocked(closeMcpConnection);
const listMcpToolsMock = vi.mocked(listMcpTools);

describe("Chunk 12 — connect, disconnect, discover", () => {
  beforeEach(async () => {
    await resetDatabase();
    mcpClient.connectCalls = 0;
    mcpClient.listToolsCalls = 0;
    mcpClient.toThrow = null;
    vi.clearAllMocks();
  });

  describe("POST /api/mcp/connections — connect", () => {
    it("persists a connected status when the MCP client succeeds", async () => {
      const user = await createTestUser("test@example.com", "Tester");
      setCurrentUser(user);

      const { POST } = await import("../app/api/mcp/connections/route");

      const req = new Request("http://localhost/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverKey: "gmail" })
      });
      const res = await POST(req);
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.connection.status).toBe("connected");
      expect(body.connection.serverKey).toBe("gmail");
      // No secret material in the response.
      expect(body.connection).not.toHaveProperty("token");
      expect(body.connection).not.toHaveProperty("accessToken");
      expect(body.connection).not.toHaveProperty("secret");
      expect(mcpClient.connectCalls).toBe(1);

      setCurrentUser(null);
    });

    it("records an error when connection fails", async () => {
      const user = await createTestUser("failer@example.com", "Failer");
      setCurrentUser(user);
      mcpClient.toThrow = new Error("ECONNREFUSED: server not reachable");

      const { POST } = await import("../app/api/mcp/connections/route");

      const req = new Request("http://localhost/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverKey: "gmail" })
      });
      const res = await POST(req);
      expect(res.status).toBe(502);

      const body = await res.json();
      expect(body.connection.status).toBe("error");
      expect(body.connection.lastError).toContain("ECONNREFUSED");
      expect(mcpClient.connectCalls).toBe(1);

      setCurrentUser(null);
    });

    it("rejects unregistered server keys", async () => {
      const user = await createTestUser("unknown@example.com", "Unknown");
      setCurrentUser(user);

      const { POST } = await import("../app/api/mcp/connections/route");

      const req = new Request("http://localhost/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverKey: "nonexistent-server-xyz" })
      });
      const res = await POST(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.message).toContain("not registered");

      setCurrentUser(null);
    });

    it("requires authentication for signed-out users", async () => {
      setCurrentUser(null);

      const { POST } = await import("../app/api/mcp/connections/route");

      const req = new Request("http://localhost/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverKey: "gmail" })
      });
      const res = await POST(req);
      expect(res.status).toBe(401);

      setCurrentUser(null);
    });
  });

  describe("DELETE /api/mcp/connections/[id] — disconnect", () => {
    it("marks connection as disconnected and revokes dependent grants", async () => {
      const user = await createTestUser("disconnector@example.com", "Disconnect");
      setCurrentUser(user);

      // Seed a connected state directly.
      const conn = await prisma.serverConnection.create({
        data: { userId: user.id, serverKey: "gmail", status: "connected" }
      });

      // Seed a discovered tool and a grant that depends on it.
      const server = await prisma.mcpServer.create({
        data: {
          name: "gmail-send-email",
          displayName: "Gmail: send_email",
          description: "Test",
          registrySource: "discovered",
          registryId: "test:gmail:send_email",
          riskLevel: "medium",
          verificationStatus: "verified",
          recommendedPermission: "draft_only",
          mcpServerKey: "gmail",
          mcpToolName: "send_email",
          isExternalSend: true
        }
      });
      const grant = await prisma.mcpAccessGrant.create({
        data: {
          userId: user.id, mcpServerId: server.id,
          canRead: true, canWrite: true, requiresApproval: true
        }
      });

      // Use a dynamic import for the DELETE handler (Next.js route).
      const { DELETE } = await import("../app/api/mcp/connections/[id]/route");

      const req = new Request(`http://localhost/api/mcp/connections/${conn.id}`, { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(200);

      // Verify connection is now disconnected.
      const updated = await prisma.serverConnection.findUnique({ where: { id: conn.id } });
      expect(updated?.status).toBe("disconnected");

      // Verify the dependent grant is revoked.
      const revokedGrant = await prisma.mcpAccessGrant.findUnique({ where: { id: grant.id } });
      expect(revokedGrant?.revokedAt).not.toBeNull();

      setCurrentUser(null);
    });

    it("blocks cross-user disconnect (ownership)", async () => {
      const owner = await createTestUser("owner@example.com", "Owner");
      const attacker = await createTestUser("attacker@example.com", "Attacker");

      setCurrentUser(owner);
      const conn = await prisma.serverConnection.create({
        data: { userId: owner.id, serverKey: "gmail", status: "connected" }
      });

      // Switch to attacker.
      setCurrentUser(attacker);

      const { DELETE } = await import("../app/api/mcp/connections/[id]/route");

      const req = new Request(`http://localhost/api/mcp/connections/${conn.id}`, { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(404); // Not found for this user

      // Owner's connection is untouched.
      const untouched = await prisma.serverConnection.findUnique({ where: { id: conn.id } });
      expect(untouched?.status).toBe("connected");

      setCurrentUser(null);
    });
  });

  describe("POST /api/mcp/connections/[id]/discover — tool discovery", () => {
    it("discovers real tools via tools/list and persists them", async () => {
      const user = await createTestUser("discoverer@example.com", "Discover");
      setCurrentUser(user);

      const conn = await prisma.serverConnection.create({
        data: { userId: user.id, serverKey: "gmail", status: "connected" }
      });

      const { POST } = await import("../app/api/mcp/connections/[id]/discover/route");

      const req = new Request(`http://localhost/api/mcp/connections/${conn.id}/discover`, { method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.tools).toHaveLength(2);
      expect(body.tools.map((t: { toolName: string }) => t.toolName).sort())
        .toEqual(["create_draft", "send_email"]);

      // Connection status updated to discovered.
      const updated = await prisma.serverConnection.findUnique({ where: { id: conn.id } });
      expect(updated?.status).toBe("discovered");
      expect(updated?.lastDiscoveredAt).not.toBeNull();

      // McpServer rows created for each tool.
      const servers = await prisma.mcpServer.findMany({
        where: { mcpServerKey: "gmail", registrySource: "discovered" }
      });
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.mcpToolName).sort()).toEqual(["create_draft", "send_email"]);

      // send_email is classified as external send.
      const sendRow = servers.find((s) => s.mcpToolName === "send_email");
      expect(sendRow?.isExternalSend).toBe(true);

      // create_draft is NOT classified as external send.
      const draftRow = servers.find((s) => s.mcpToolName === "create_draft");
      expect(draftRow?.isExternalSend).toBe(false);

      // McpTool rows with schemas created.
      const toolRows = await prisma.mcpTool.findMany({ where: { mcpServerId: { in: servers.map((s) => s.id) } } });
      expect(toolRows).toHaveLength(2);
      const sendTool = toolRows.find((t) => t.name === "send_email");
      expect(sendTool?.inputSchema).not.toBeNull();

      expect(mcpClient.listToolsCalls).toBe(1);

      setCurrentUser(null);
    });

    it("surfaces discovery errors, never synthesizes fake tools", async () => {
      const user = await createTestUser("baddiscover@example.com", "BadDiscover");
      setCurrentUser(user);
      mcpClient.toThrow = new Error("tools/list timeout after 30s");

      const conn = await prisma.serverConnection.create({
        data: { userId: user.id, serverKey: "gmail", status: "connected" }
      });

      const { POST } = await import("../app/api/mcp/connections/[id]/discover/route");

      const req = new Request(`http://localhost/api/mcp/connections/${conn.id}/discover`, { method: "POST" });
      const res = await POST(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(502);

      const body = await res.json();
      expect(body.message).toContain("timeout");

      // Connection status NOT set to discovered.
      const updated = await prisma.serverConnection.findUnique({ where: { id: conn.id } });
      expect(updated?.status).not.toBe("discovered");
      expect(updated?.lastError).toContain("timeout");

      // No tools persisted (no fake tool list).
      const servers = await prisma.mcpServer.findMany({
        where: { mcpServerKey: "gmail", registrySource: "discovered" }
      });
      expect(servers).toHaveLength(0);

      setCurrentUser(null);
    });

    it("re-discovers and reconciles (removes stale tools, adds new ones)", async () => {
      const user = await createTestUser("rediscover@example.com", "Rediscover");
      setCurrentUser(user);

      const conn = await prisma.serverConnection.create({
        data: { userId: user.id, serverKey: "gmail", status: "connected" }
      });

      // First discovery: both tools found.
      const { POST } = await import("../app/api/mcp/connections/[id]/discover/route");
      let req = new Request(`http://localhost/api/mcp/connections/${conn.id}/discover`, { method: "POST" });
      let res = await POST(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(200);

      // Second discovery: only one tool remains (create_draft removed).
      mcpClient.tools = [
        { name: "send_email", description: "Send an email", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } } } }
      ];
      req = new Request(`http://localhost/api/mcp/connections/${conn.id}/discover`, { method: "POST" });
      res = await POST(req, { params: Promise.resolve({ id: conn.id }) });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.reconciled.removed).toContain("create_draft");

      const servers = await prisma.mcpServer.findMany({
        where: { mcpServerKey: "gmail", registrySource: "discovered" }
      });
      expect(servers).toHaveLength(1);
      expect(servers[0].mcpToolName).toBe("send_email");

      setCurrentUser(null);
    });
  });

  describe("generality: second MCP server through identical surface", () => {
    it("connects, discovers, and lists tools for echo-mcp with zero new UI/endpoint code", async () => {
      const user = await createTestUser("second@example.com", "Second Server");
      setCurrentUser(user);

      // Use the SECOND registered server (echo-mcp) — same connect endpoint,
      // same discover endpoint, same tools endpoint. Proves the surface is
      // server-generic.
      mcpClient.tools = [
        { name: "echo", description: "Echoes the input", inputSchema: { type: "object", properties: { message: { type: "string" } } } }
      ];

      const { POST: connectPost } = await import("../app/api/mcp/connections/route");

      // Connect to echo-mcp (the second server).
      let req = new Request("http://localhost/api/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverKey: "echo-mcp" })
      });
      let res = await connectPost(req);
      expect(res.status).toBe(201);
      const connectBody = await res.json();
      expect(connectBody.connection.status).toBe("connected");
      expect(connectBody.connection.serverKey).toBe("echo-mcp");

      // Discover tools.
      const { POST: discoverPost } = await import("../app/api/mcp/connections/[id]/discover/route");
      req = new Request(`http://localhost/api/mcp/connections/${connectBody.connection.id}/discover`, { method: "POST" });
      res = await discoverPost(req, { params: Promise.resolve({ id: connectBody.connection.id }) });
      expect(res.status).toBe(200);
      const discBody = await res.json();
      expect(discBody.tools.map((t: { toolName: string }) => t.toolName)).toContain("echo");

      // List discovered tools.
      const { GET: toolsGet } = await import("../app/api/mcp/connections/[id]/tools/route");
      req = new Request(`http://localhost/api/mcp/connections/${connectBody.connection.id}/tools`);
      res = await toolsGet(req, { params: Promise.resolve({ id: connectBody.connection.id }) });
      expect(res.status).toBe(200);
      const toolsBody = await res.json();
      expect(toolsBody.tools[0].toolName).toBe("echo");

      // Verify: the echo-mcp server's authProvider is null (no OAuth needed),
      // unlike gmail which requires google OAuth. This proves per-server
      // auth varies without any server-specific code.
      const conn = await prisma.serverConnection.findUnique({ where: { id: connectBody.connection.id } });
      expect(conn?.authProvider).toBeNull();

      setCurrentUser(null);
    });
  });
});
