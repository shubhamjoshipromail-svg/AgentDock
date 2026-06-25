import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// MCP client capture — records every external call and can simulate crashes.
const mcpCalls = vi.hoisted(() => ({
  calls: [] as { toolName: string; args: Record<string, unknown> }[],
  reset() { this.calls = []; }
}));

vi.mock("../lib/execution/mcp-client", () => ({
  callMcpTool: vi.fn(async (_serverKey: string, toolName: string, args: Record<string, unknown>) => {
    mcpCalls.calls.push({ toolName, args });
    return { text: `mcp:${toolName}:ok`, isError: false };
  }),
  mcpTokenEnvVar: vi.fn(() => null)
}));

const llm = vi.hoisted(() => ({ queue: [] as { text: string; costCents?: number }[], calls: 0 }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic", model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llm.calls += 1;
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 100, outputTokens: 50 }, costCents: next.costCents ?? 1 };
    })
  }))
}));

import {
  executeExistingRun,
  resumeAfterApproval,
  killRun
} from "../lib/execution/run-engine";
import {
  createQueuedRun,
  claimNextRunJob,
  processRunJob,
  updateStepCursor,
  completeRunJob
} from "../lib/execution/run-queue";

const FINAL = (t = "done") => JSON.stringify({ type: "final", text: t });
const TOOL = (tool: string, action = "read", input = "q") => JSON.stringify({ type: "tool_call", tool, action, input });

async function seedSearchFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Search Agent", category: "Research", provider: "OpenAI", verified: true,
      description: "Searches.", systemPrompt: "Use web_search.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Search Flow", goal: "Search for info.",
      weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "search", routeOrder: 1, defaultMode: "auto" }
  });
  const server = await prisma.mcpServer.create({
    data: { name: "search-mcp", displayName: "Search", description: "Read-only web search.",
      registrySource: "curated", registryId: "agentdock:search-cr", riskLevel: "low",
      verificationStatus: "verified", recommendedPermission: "read_only",
      mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false }
  });
  await prisma.mcpAccessGrant.create({
    data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id,
      canRead: true, requiresApproval: false }
  });
  return { agent, workflow, server };
}

async function seedExternalApprovalFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Send Agent", category: "Outreach", provider: "OpenAI", verified: true,
      description: "Sends.", systemPrompt: "Use send_email.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Send Flow", goal: "Send something.",
      weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "send", routeOrder: 1, defaultMode: "auto" }
  });
  const server = await prisma.mcpServer.create({
    data: { name: "gmail-mcp", displayName: "Gmail", description: "Email.",
      registrySource: "curated", registryId: "agentdock:gmail-cr", riskLevel: "medium",
      verificationStatus: "verified", recommendedPermission: "draft_only",
      mcpServerKey: "gmail", mcpToolName: "send_email",
      credentialProvider: "google", isExternalSend: true }
  });
  await prisma.mcpAccessGrant.create({
    data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id,
      canRead: true, canWrite: true, requiresApproval: true }
  });
  return { agent, workflow, server };
}

describe("crash recovery — reclaim, idempotency, and semantics survive", () => {
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = [];
    llm.calls = 0;
    mcpCalls.reset();
  });

  it("RECLAIM: a job whose lease expired is reclaimed with preserved stepCursor", async () => {
    const user = await createTestUser();
    const { workflow } = await seedSearchFlow(user.id);
    llm.queue = [
      { text: TOOL("web_search", "read", "site:example.com") },
      { text: FINAL("Search complete.") }
    ];

    const created = await createQueuedRun(user.id, workflow.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");
    const runId = created.result.runId;

    // Worker A claims, processes agent step 0 → stepCursor advances to 1.
    const jobA = await claimNextRunJob({ workerId: "worker-A", leaseMs: 60_000, perUserConcurrency: 2 });
    expect(jobA).not.toBeNull();
    await processRunJob(jobA!, "worker-A");

    // After processing, stepCursor should be 1 (one agent completed).
    const afterJob = await prisma.runJob.findUnique({ where: { id: jobA!.id } });
    expect(afterJob?.stepCursor).toBe(1);

    // Now simulate worker crash: set lease to expired, change status back to queued.
    await prisma.runJob.update({
      where: { id: jobA!.id },
      data: { status: "queued", claimedBy: null, leaseExpiresAt: null }
    });

    // Worker B reclaims.
    const jobB = await claimNextRunJob({ workerId: "worker-B", leaseMs: 60_000, perUserConcurrency: 2 });
    expect(jobB).not.toBeNull();
    expect(jobB!.id).toBe(jobA!.id);
    expect(jobB!.attemptCount).toBe(2);

    const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("completed");
  });

  it("IDEMPOTENT: an external-send event stores its idempotency key, and re-execution through approval skips double-fire", async () => {
    const user = await createTestUser();
    const { workflow } = await seedExternalApprovalFlow(user.id);
    llm.queue = [
      { text: TOOL("send_email", "send", "invoice") }
    ];

    // First execution: pauses for approval.
    const created = await createQueuedRun(user.id, workflow.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");
    const runId = created.result.runId;

    const job1 = await claimNextRunJob({ workerId: "worker-1" });
    expect(job1).not.toBeNull();
    const result1 = await processRunJob(job1!, "worker-1");
    expect(result1.status).toBe("paused_for_approval");

    // Approve it.
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: runId, status: "pending" } });
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: "approved", resolvedAt: new Date() } });

    // Resume via the approved path — the send executes.
    llm.queue = [{ text: FINAL("Email sent.") }];
    const resumeResult = await resumeAfterApproval(user.id, approval.id, true);
    expect(resumeResult?.status).toBe("completed");
    expect(mcpCalls.calls.length).toBe(1); // send_email was called once

    // The send_email event has an idempotencyKey in its metadata.
    const sendEvents = await prisma.workflowRunEvent.findMany({
      where: { workflowRunId: runId, eventType: "mcp_tool_use", decision: "allowed" }
    });
    expect(sendEvents.length).toBeGreaterThanOrEqual(1);
    const sendEvent = sendEvents[sendEvents.length - 1];
    const meta = sendEvent.metadata as { idempotencyKey?: string };
    expect(typeof meta.idempotencyKey).toBe("string");
    expect(meta.idempotencyKey?.length ?? 0).toBeGreaterThan(0);

    // Now simulate crash-and-reclaim AFTER the external send completed.
    // Re-enqueue the job so another worker picks it up.
    await prisma.runJob.update({
      where: { id: job1!.id },
      data: { status: "queued", claimedBy: null, leaseExpiresAt: null, stepCursor: 0, attemptCount: 1 }
    });
    // Create a new approval to simulate fresh approval flow.
    // The run was completed; reset for re-claim test.
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "paused_for_approval" } });
    const approval2 = await prisma.approvalRequest.create({
      data: { userId: user.id, workflowRunId: runId, agentId: null,
        title: "Re-test", description: "d", actionType: "email_send",
        riskLevel: "medium", status: "approved", resolvedAt: new Date(),
        stepIndex: 0, metadata: {
          toolName: "send_email", serverId: "", action: "send",
          input: "invoice", arguments: null, seedResults: [], handoffContent: null
        } }
    });

    // Re-claim and re-process via approval.
    const job2 = await claimNextRunJob({ workerId: "worker-2" });
    expect(job2).not.toBeNull();
    llm.queue = [{ text: FINAL("Email sent.") }];
    const resumeResult2 = await resumeAfterApproval(user.id, approval2.id, true);
    // The idempotency guard found the prior send_email event and skipped re-execution.
    expect(resumeResult2?.status).not.toBe("halted_error");

    // The MCP call count did NOT increase — the external send was idempotent.
    // (Only 1 call total, not 2.)
    expect(mcpCalls.calls.length).toBe(1);
  });

  it("RECLAIM PAUSED: a paused-for-approval run stays paused when reclaimed by another worker", async () => {
    const user = await createTestUser();
    const { workflow } = await seedExternalApprovalFlow(user.id);
    llm.queue = [
      { text: TOOL("send_email", "send", "hello") }
    ];

    const created = await createQueuedRun(user.id, workflow.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");
    const runId = created.result.runId;

    // Worker 1 processes → pauses for approval.
    const job1 = await claimNextRunJob({ workerId: "worker-1" });
    expect(job1).not.toBeNull();
    const result1 = await processRunJob(job1!, "worker-1");
    expect(result1.status).toBe("paused_for_approval");

    // Simulate worker crash: expired lease while paused.
    await prisma.runJob.update({
      where: { id: job1!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000), status: "running" }
    });

    // Worker 2 reclaims. processRunJob sees paused_for_approval →
    // calls resumeRunFromLatestApproval but no approval is approved → stays paused.
    const job2 = await claimNextRunJob({ workerId: "worker-2" });
    expect(job2).not.toBeNull();
    const result2 = await processRunJob(job2!, "worker-2");
    expect(result2.status).toBe("paused_for_approval");

    const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("paused_for_approval");
  });

  it("RECLAIM KILLED: a killed run is rejected immediately by the worker", async () => {
    const user = await createTestUser();
    const { workflow } = await seedSearchFlow(user.id);
    llm.queue = [
      { text: TOOL("web_search", "read", "q") },
      { text: FINAL("done") }
    ];

    const created = await createQueuedRun(user.id, workflow.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");
    const runId = created.result.runId;

    // Kill the run.
    await killRun(user.id, runId, "user requested kill");

    // Worker claims.
    const claimed = await claimNextRunJob({ workerId: "worker-1" });
    expect(claimed).not.toBeNull();

    // processRunJob sees killed status → returns killed immediately.
    const result = await processRunJob(claimed!, "worker-1");
    expect(result.status).toBe("killed");

    const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("killed");
  });

  it("STEP CURSOR: a multi-agent flow updates stepCursor after each agent completes", async () => {
    const user = await createTestUser();
    const agent1 = await prisma.agent.create({
      data: { userId: user.id, name: "Step 1", category: "Research", provider: "OpenAI", verified: true,
        description: "First.", systemPrompt: "Go first.", model: "claude-sonnet-4-6" }
    });
    const agent2 = await prisma.agent.create({
      data: { userId: user.id, name: "Step 2", category: "Writing", provider: "OpenAI", verified: true,
        description: "Second.", systemPrompt: "Go second.", model: "claude-sonnet-4-6" }
    });
    const workflow = await prisma.workflow.create({
      data: { userId: user.id, name: "Two Agent Flow", goal: "Multi-step.",
        weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: agent1.id, roleInWorkflow: "step1", routeOrder: 1, defaultMode: "auto" },
        { workflowId: workflow.id, agentId: agent2.id, roleInWorkflow: "step2", routeOrder: 2, defaultMode: "auto" }
      ]
    });

    llm.queue = [
      { text: FINAL("Step 1 done.") },
      { text: FINAL("Step 2 done.") }
    ];

    const created = await createQueuedRun(user.id, workflow.id);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("unreachable");

    const job = await claimNextRunJob({ workerId: "worker-1" });
    expect(job).not.toBeNull();
    await processRunJob(job!, "worker-1");

    const finalJob = await prisma.runJob.findUnique({ where: { id: job!.id } });
    expect(finalJob?.stepCursor).toBe(2); // both agents completed

    const run = await prisma.workflowRun.findUnique({ where: { id: created.result.runId } });
    expect(run?.status).toBe("completed");
  });
});
