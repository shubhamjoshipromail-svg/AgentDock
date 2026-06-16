import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { GET as getServers } from "../app/api/mcp/servers/route";
import { GET as getWorkflowMcps, POST as attachMcp } from "../app/api/workflows/[workflowId]/mcps/route";
import { POST as createWorkflow } from "../app/api/workflows/route";

function params<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

function jsonPost(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function seedServers() {
  const verified = await prisma.mcpServer.createMany({
    data: [
      {
        name: "curated-search",
        displayName: "Search MCP",
        description: "Public web search tool",
        registrySource: "agentdock-curated",
        registryId: "agentdock:search-mcp",
        category: "Public info",
        riskLevel: "low",
        verificationStatus: "verified",
        recommendedPermission: "read_only"
      },
      {
        name: "curated-github",
        displayName: "GitHub MCP",
        description: "GitHub repository metadata tool",
        registrySource: "agentdock-curated",
        registryId: "agentdock:github-mcp",
        category: "Developer tools",
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "approval_required"
      }
    ]
  });

  const external = await prisma.mcpServer.createMany({
    data: [
      {
        name: "reg:ext.org/github-ext",
        displayName: "External GitHub Tool",
        description: "External server wrapping GitHub API",
        registrySource: "mcp-official-registry",
        registryId: "ext.org/github-ext",
        riskLevel: "medium",
        verificationStatus: "unverified",
        recommendedPermission: "approval_required"
      },
      {
        name: "reg:ext.org/slack-tool",
        displayName: "Slack Tool",
        description: "External Slack integration",
        registrySource: "mcp-official-registry",
        registryId: "ext.org/slack-tool",
        riskLevel: "medium",
        verificationStatus: "unverified",
        recommendedPermission: "approval_required"
      }
    ]
  });

  return { verified, external };
}

async function createTestWorkflow(userId: string) {
  const response = await createWorkflow(jsonPost("http://localhost/api/workflows", {
    name: "Test Flow",
    goal: "Test attaching tools.",
    weeklyBudgetCents: 100,
    maxRunBudgetCents: 50,
    approvalMode: "manual",
    agents: [{ agentName: "Test Agent", roleInWorkflow: "Test", routeOrder: 1, defaultMode: "Auto" }]
  }));
  const data = await response.json();
  return data.workflow as { id: string };
}

describe("GET /api/mcp/servers — search, filter, paginate", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
    await seedServers();
  });

  it("returns all servers with total count and no nextCursor when all fit in one page", async () => {
    const response = await getServers(new Request("http://localhost/api/mcp/servers"));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.servers.length).toBe(4);
    expect(data.total).toBe(4);
    expect(data.nextCursor).toBeNull();
  });

  it("search by name fragment returns matching entries", async () => {
    const response = await getServers(new Request("http://localhost/api/mcp/servers?q=github"));
    const data = await response.json();
    expect(data.servers.length).toBeGreaterThan(0);
    for (const server of data.servers) {
      const hasFragment =
        server.displayName.toLowerCase().includes("github") ||
        server.description.toLowerCase().includes("github");
      expect(hasFragment).toBe(true);
    }
  });

  it("filter verification=verified returns only verified curated tier", async () => {
    const response = await getServers(
      new Request("http://localhost/api/mcp/servers?verification=verified")
    );
    const data = await response.json();
    expect(data.servers.length).toBe(2);
    for (const server of data.servers) {
      expect(server.verificationStatus).toBe("verified");
    }
  });

  it("filter verification=unverified returns only external servers", async () => {
    const response = await getServers(
      new Request("http://localhost/api/mcp/servers?verification=unverified")
    );
    const data = await response.json();
    expect(data.servers.length).toBe(2);
    for (const server of data.servers) {
      expect(server.verificationStatus).toBe("unverified");
    }
  });

  it("pagination cursor walks the full set without overlap or gaps", async () => {
    const page1Response = await getServers(
      new Request("http://localhost/api/mcp/servers?limit=2")
    );
    const page1 = await page1Response.json();
    expect(page1.servers).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();

    const page2Response = await getServers(
      new Request(`http://localhost/api/mcp/servers?limit=2&cursor=${page1.nextCursor}`)
    );
    const page2 = await page2Response.json();
    expect(page2.servers).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    // No overlap between pages
    const page1Ids = new Set(page1.servers.map((s: { id: string }) => s.id));
    for (const server of page2.servers) {
      expect(page1Ids.has(server.id)).toBe(false);
    }

    // Total is consistent
    expect(page1.total).toBe(4);
    expect(page2.total).toBe(4);
  });

  it("filter by source returns only that source", async () => {
    const response = await getServers(
      new Request("http://localhost/api/mcp/servers?source=mcp-official-registry")
    );
    const data = await response.json();
    expect(data.servers.length).toBe(2);
    for (const server of data.servers) {
      expect(server.registrySource).toBe("mcp-official-registry");
    }
  });
});

describe("Attaching unverified external server to Flow", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("produces approval_required read-only grant for unverified server", async () => {
    const user = await createTestUser("attach-test@example.com", "Attach Test User");
    setCurrentUser(user);

    const unverifiedServer = await prisma.mcpServer.create({
      data: {
        name: "reg:test.org/unverified-tool",
        displayName: "Unverified Tool",
        description: "External unverified server.",
        registrySource: "mcp-official-registry",
        registryId: "test.org/unverified-tool",
        riskLevel: "medium",
        verificationStatus: "unverified",
        recommendedPermission: "approval_required"
      }
    });

    const workflow = await createTestWorkflow(user.id);

    const attachResponse = await attachMcp(
      jsonPost(`http://localhost/api/workflows/${workflow.id}/mcps`, {
        mcpServerId: unverifiedServer.id
      }),
      params({ workflowId: workflow.id })
    );
    expect(attachResponse.status).toBe(201);

    const { accessGrant } = await attachResponse.json();

    // Grant must be approval-required and read-only (no write/execute/delete)
    expect(accessGrant.requiresApproval).toBe(true);
    expect(accessGrant.canWrite).toBe(false);
    expect(accessGrant.canExecute).toBe(false);
    expect(accessGrant.canDelete).toBe(false);
  });

  it("GET /api/workflows/[id]/mcps returns attachments with grant details", async () => {
    const user = await createTestUser("get-mcps-test@example.com", "Get MCPs Test User");
    setCurrentUser(user);

    const server = await prisma.mcpServer.create({
      data: {
        name: "reg:test.org/get-mcps-tool",
        displayName: "Get MCPs Tool",
        description: "For get MCPs test.",
        registrySource: "mcp-official-registry",
        registryId: "test.org/get-mcps-tool",
        riskLevel: "low",
        verificationStatus: "unverified",
        recommendedPermission: "approval_required"
      }
    });

    const workflow = await createTestWorkflow(user.id);

    await attachMcp(
      jsonPost(`http://localhost/api/workflows/${workflow.id}/mcps`, {
        mcpServerId: server.id
      }),
      params({ workflowId: workflow.id })
    );

    const getResponse = await getWorkflowMcps(
      new Request(`http://localhost/api/workflows/${workflow.id}/mcps`),
      params({ workflowId: workflow.id })
    );
    expect(getResponse.status).toBe(200);

    const { attachments } = await getResponse.json();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].mcpServer.id).toBe(server.id);
    expect(attachments[0].accessGrant).not.toBeNull();
    expect(attachments[0].accessGrant.requiresApproval).toBe(true);
  });
});
