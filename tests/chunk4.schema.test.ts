import { beforeEach, describe, expect, it } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import { encryptSecret, last4 } from "../lib/execution/crypto";

describe("chunk 4 execution schema", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists mandate fields on McpAccessGrant", async () => {
    const user = await createTestUser();
    const server = await prisma.mcpServer.create({
      data: {
        name: "search-mcp", displayName: "Search MCP", description: "Read-only web search.",
        registrySource: "curated", riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only",
        mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false
      }
    });
    const expiresAt = new Date(Date.now() + 86_400_000);
    const grant = await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id, mcpServerId: server.id, canRead: true,
        scope: "web_search:read", limitCents: 50, expiresAt
      }
    });
    expect(grant.scope).toBe("web_search:read");
    expect(grant.limitCents).toBe(50);
    expect(grant.revokedAt).toBeNull();
  });

  it("persists mandate fields + step index on ApprovalRequest", async () => {
    const user = await createTestUser();
    const workflow = await prisma.workflow.create({
      data: { userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
    });
    const run = await prisma.workflowRun.create({
      data: { userId: user.id, workflowId: workflow.id, riskLevel: "medium", status: "paused_for_approval" }
    });
    const approval = await prisma.approvalRequest.create({
      data: {
        userId: user.id, workflowRunId: run.id, title: "Send email?", description: "Outreach send",
        actionType: "email_send", riskLevel: "high", stepIndex: 3, scope: "gmail:send", limitCents: 0
      }
    });
    expect(approval.stepIndex).toBe(3);
    expect(approval.scope).toBe("gmail:send");
  });

  it("stores an encrypted credential — ciphertext + last4, never plaintext", async () => {
    const user = await createTestUser();
    const PLAINTEXT = "sk-ant-abcdefg-7777";
    const enc = encryptSecret(PLAINTEXT);
    const cred = await prisma.scopedCredential.create({
      data: {
        userId: user.id, provider: "anthropic", credentialType: "byo_api_key",
        scopeDescription: "BYO Anthropic key", status: "active",
        encryptedKey: enc.encryptedKey, encryptionIv: enc.encryptionIv,
        encryptionAuthTag: enc.encryptionAuthTag, last4: last4(PLAINTEXT)
      }
    });
    expect(cred.last4).toBe("7777");
    expect(cred.encryptedKey).not.toContain(PLAINTEXT);
    // Re-read and confirm no column holds the plaintext.
    const row = await prisma.scopedCredential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT);
  });

  it("persists immutable-audit fields on WorkflowRunEvent", async () => {
    const user = await createTestUser();
    const workflow = await prisma.workflow.create({
      data: { userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
    });
    const run = await prisma.workflowRun.create({
      data: { userId: user.id, workflowId: workflow.id, riskLevel: "low", status: "running" }
    });
    const event = await prisma.workflowRunEvent.create({
      data: {
        workflowRunId: run.id, userId: user.id, eventType: "mcp_tool_use",
        title: "search", description: "web search", decision: "allowed", costCents: 1,
        actorType: "agent", actorId: "agent-x", resourceType: "tool", resourceId: "search-mcp",
        authorityRef: "grant-123", untrusted: true, schemaVersion: 1
      }
    });
    expect(event.actorType).toBe("agent");
    expect(event.authorityRef).toBe("grant-123");
    expect(event.untrusted).toBe(true);
    expect(event.schemaVersion).toBe(1);
  });
});
