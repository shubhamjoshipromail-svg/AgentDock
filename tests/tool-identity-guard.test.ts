import { describe, expect, it, beforeEach } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";

describe("canonical tool identity guard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects grants for catalog-only tools with no executable MCP identity", async () => {
    const user = await createTestUser();
    const workflow = await prisma.workflow.create({
      data: {
        userId: user.id,
        name: "Flow",
        goal: "Do something",
        weeklyBudgetCents: 500,
        maxRunBudgetCents: 100,
        approvalMode: "approval_gated"
      }
    });
    const catalogOnly = await prisma.mcpServer.create({
      data: {
        name: "docs-notion-mcp",
        displayName: "Docs / Notion MCP",
        description: "Metadata only.",
        registrySource: "curated",
        registryId: "agentdock:docs-notion-mcp",
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "approval_required"
      }
    });

    await expect(
      prisma.mcpAccessGrant.create({
        data: {
          userId: user.id,
          workflowId: workflow.id,
          mcpServerId: catalogOnly.id,
          canRead: true,
          requiresApproval: true
        }
      })
    ).rejects.toThrow(/executable tool identity/i);
  });

  it("allows grants for tools bound to a registered server and discovered tool", async () => {
    const user = await createTestUser();
    const workflow = await prisma.workflow.create({
      data: {
        userId: user.id,
        name: "Flow",
        goal: "Search",
        weeklyBudgetCents: 500,
        maxRunBudgetCents: 100,
        approvalMode: "approval_gated"
      }
    });
    const search = await prisma.mcpServer.create({
      data: {
        name: "search-mcp",
        displayName: "Search MCP",
        description: "Executable search.",
        registrySource: "curated",
        registryId: "agentdock:search-mcp",
        riskLevel: "low",
        verificationStatus: "verified",
        recommendedPermission: "read_only",
        mcpServerKey: "search",
        mcpToolName: "web_search"
      }
    });

    const grant = await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id,
        workflowId: workflow.id,
        mcpServerId: search.id,
        canRead: true,
        requiresApproval: false
      }
    });

    expect(grant.mcpServerId).toBe(search.id);
  });
});
