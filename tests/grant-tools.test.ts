import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Mock provider + MCP client so the run engine doesn't need real keys/processes.
const llm = vi.hoisted(() => ({ queue: [] as { text: string; costCents?: number }[], calls: 0 }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llm.calls += 1;
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: next.costCents ?? 1 };
    })
  }))
}));

vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return { ...actual, callMcpTool: vi.fn(async () => ({ text: "ok: performed", isError: false })) };
});

import { callMcpTool } from "../lib/execution/mcp-client";
import { resumeAfterApproval, startRun } from "../lib/execution/run-engine";

const callMcpToolMock = vi.mocked(callMcpTool);

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) =>
  JSON.stringify({ type: "tool_call", tool, arguments: args });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

describe("Chunk 12 Phase 3 — grant discovered tools into a flow", () => {
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = [];
    llm.calls = 0;
    vi.clearAllMocks();
  });

  async function seedDiscoveredFlow(userId: string) {
    // Create agent + workflow.
    const agent = await prisma.agent.create({
      data: {
        userId, name: "Test Agent", category: "Test", provider: "OpenAI",
        verified: true, description: "Test.", systemPrompt: "Use tools.", model: "gpt-4"
      }
    });
    const workflow = await prisma.workflow.create({
      data: {
        userId, name: "Test Flow", goal: "Do a thing.",
        weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated"
      }
    });
    await prisma.workflowAgent.create({
      data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "tester", routeOrder: 1, defaultMode: "auto" }
    });

    // Create discovered tool rows (simulating what discovery would create).
    const sendServer = await prisma.mcpServer.create({
      data: {
        name: "gmail-send-email",
        displayName: "Gmail: send_email",
        description: "Send email",
        registrySource: "discovered",
        registryId: "agentdock:discovered:gmail:send_email",
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "draft_only",
        mcpServerKey: "gmail",
        mcpToolName: "send_email",
        credentialProvider: "google",
        isExternalSend: true
      }
    });

    const draftServer = await prisma.mcpServer.create({
      data: {
        name: "gmail-create-draft",
        displayName: "Gmail: create_draft",
        description: "Create draft",
        registrySource: "discovered",
        registryId: "agentdock:discovered:gmail:create_draft",
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "draft_only",
        mcpServerKey: "gmail",
        mcpToolName: "create_draft",
        credentialProvider: "google",
        isExternalSend: false
      }
    });

    return { agent, workflow, sendServer, draftServer };
  }

  it("granted discovered tool is executable via the generic path", async () => {
    const user = await createTestUser("granter@example.com", "Granter");
    setCurrentUser(user);

    const { workflow, draftServer } = await seedDiscoveredFlow(user.id);

    // Grant the draft tool (reversible mailbox write, no external send).
    await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id, workflowId: workflow.id, mcpServerId: draftServer.id,
        canRead: true, canWrite: true, requiresApproval: false
      }
    });

    // Run: the generic gate pauses the draft write, then approval executes it.
    llm.queue = [
      { text: TOOL_ARGS("create_draft", { to: "x@y.com", subject: "Hi", body: "Hello" }) },
      { text: FINAL("Draft created.") }
    ];

    const result = await startRun(user.id, workflow.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.result.status).toBe("paused_for_approval");
    expect(callMcpToolMock).not.toHaveBeenCalled();
    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: result.result.runId, status: "pending" }
    });
    expect((await resumeAfterApproval(user.id, approval.id, true))?.status).toBe("completed");

    // create_draft was called via the real MCP execution path.
    expect(callMcpToolMock).toHaveBeenCalled();
    const call = callMcpToolMock.mock.calls.find(
      (c) => c[1] === "create_draft"
    );
    expect(call).toBeDefined();
    // The arguments are structured (not a string).
    expect(call![2]).toMatchObject({ to: "x@y.com", subject: "Hi", body: "Hello" });

    setCurrentUser(null);
  });

  it("ungranted discovered tool is denied by default", async () => {
    const user = await createTestUser("denier@example.com", "Denier");
    setCurrentUser(user);

    const { workflow, sendServer } = await seedDiscoveredFlow(user.id);

    // Grant send_email with requiresApproval = true (external send → approval).
    await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id, workflowId: workflow.id, mcpServerId: sendServer.id,
        canRead: true, canWrite: true, requiresApproval: true
      }
    });

    // Run: agent tries send_email without having create_draft granted.
    // create_draft is NOT granted → should be denied by the gate.
    llm.queue = [
      { text: TOOL_ARGS("create_draft", { to: "x@y.com", subject: "Hi", body: "Hello" }) },
      { text: FINAL("Blocked.") }
    ];

    const result = await startRun(user.id, workflow.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");

    // The agent tried create_draft but it's not in the allow-list → blocked.
    const events = await prisma.workflowRunEvent.findMany({
      where: { workflowRunId: result.result.runId, eventType: "action_blocked" }
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const blockedEvent = events.find((e) => e.title.includes("create_draft"));
    expect(blockedEvent).toBeDefined();

    setCurrentUser(null);
  });

  it("removing a grant blocks the tool (flow truth)", async () => {
    const user = await createTestUser("remover@example.com", "Remover");
    setCurrentUser(user);

    const { workflow, draftServer } = await seedDiscoveredFlow(user.id);

    // Grant, then revoke.
    const grant = await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id, workflowId: workflow.id, mcpServerId: draftServer.id,
        canRead: true, canWrite: true, requiresApproval: false
      }
    });
    await prisma.mcpAccessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() }
    });

    // Run: agent tries create_draft — the grant is revoked → blocked.
    llm.queue = [
      { text: TOOL_ARGS("create_draft", { to: "x@y.com", subject: "Hi", body: "Hello" }) },
      { text: FINAL("Blocked.") }
    ];

    const result = await startRun(user.id, workflow.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");

    const events = await prisma.workflowRunEvent.findMany({
      where: { workflowRunId: result.result.runId, eventType: "action_blocked" }
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    setCurrentUser(null);
  });

  it("granted identity === executed identity (the Chunk 9/10 invariant)", async () => {
    const user = await createTestUser("identity@example.com", "Identity");
    setCurrentUser(user);

    const { workflow, sendServer } = await seedDiscoveredFlow(user.id);

    // Grant send_email (external send → approval required by classification).
    await prisma.mcpAccessGrant.create({
      data: {
        userId: user.id, workflowId: workflow.id, mcpServerId: sendServer.id,
        canRead: true, canWrite: true, requiresApproval: false
      }
    });

    // Load what the engine would load (the same path as the run engine).
    const { loadRunnable } = await import("../lib/execution/run-engine");
    const runnable = await loadRunnable(user.id, workflow.id);
    expect(runnable).not.toBeNull();

    const agent = runnable!.agents[0];
    expect(agent).toBeDefined();

    // The allowedTools should include send_email with the correct generic identity.
    const sendTool = agent.allowedTools.find((t) => t.toolName === "send_email");
    expect(sendTool).toBeDefined();
    expect(sendTool!.server.mcpServerKey).toBe("gmail");
    expect(sendTool!.server.mcpToolName).toBe("send_email");
    expect(sendTool!.isExternalSend).toBe(true);
    // The grant permission matches what was set.
    expect(sendTool!.grant.canWrite).toBe(true);

    setCurrentUser(null);
  });
});
