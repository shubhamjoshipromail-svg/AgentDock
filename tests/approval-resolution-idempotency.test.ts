import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// ============================================================================
// APPROVAL RESOLUTION IS SINGLE-SHOT (Chunk 22 Phase 2).
//
// An approval is a record of human consent. Before this, the resolve route read
// the row and then wrote it with no status predicate, so:
//   - a DENIED approval could be replayed into APPROVED (HTTP 200), forging the
//     consent record and the audit trail, and
//   - a second resolve re-enqueued the run, resetting a job a worker had already
//     claimed to queued/claimedBy:null — handing the same run to a second worker.
//
// Every test here drives the REAL route (and the real queue helpers), never an
// internal shortcut, so it reproduces the production seam.
// ============================================================================

let user: Awaited<ReturnType<typeof createTestUser>>;

async function resolveRoute() {
  return (await import("../app/api/approvals/[id]/resolve/route")).POST;
}

function post(id: string, body: unknown, idempotencyKey?: string) {
  return new Request("http://localhost/api/approvals/x/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  });
}

async function callResolve(id: string, body: unknown, idempotencyKey?: string) {
  const POST = await resolveRoute();
  return POST(post(id, body, idempotencyKey), { params: Promise.resolve({ id }) });
}

async function seedPausedRun() {
  const agent = await prisma.agent.create({
    data: {
      userId: user.id, name: `A-${Math.random()}`, category: "c", provider: "p",
      verified: true, description: "d", systemPrompt: "s", model: "claude-sonnet-4-6"
    }
  });
  const workflow = await prisma.workflow.create({
    data: {
      userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500,
      maxRunBudgetCents: 100, approvalMode: "approval_gated"
    }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" }
  });
  const run = await prisma.workflowRun.create({
    data: {
      userId: user.id, workflowId: workflow.id, status: "paused_for_approval",
      riskLevel: "medium", startedAt: new Date(), idempotencyKey: `run-${Math.random()}`
    }
  });
  const job = await prisma.runJob.create({
    data: { userId: user.id, workflowRunId: run.id, status: "paused" }
  });
  return { agent, workflow, run, job };
}

async function seedApproval(runId: string, agentId: string) {
  return prisma.approvalRequest.create({
    data: {
      userId: user.id, workflowRunId: runId, agentId, intentType: "approval",
      title: "Send email", description: "d", actionType: "email_send", riskLevel: "medium",
      status: "pending", stepIndex: 0, scope: "send_email:send",
      metadata: { toolName: "send_email", serverId: "", action: "send", input: "x" }
    }
  });
}

async function seedChoiceIntent(runId: string, agentId: string) {
  return prisma.approvalRequest.create({
    data: {
      userId: user.id, workflowRunId: runId, agentId, intentType: "choice",
      title: "Pick one", description: "d", actionType: "tool_scope_change", riskLevel: "low",
      status: "pending", stepIndex: 0,
      payload: { prompt: "Pick one", options: [{ id: "a", title: "A" }, { id: "b", title: "B" }] },
      metadata: { seedResults: [], handoffContent: null }
    }
  });
}

beforeEach(async () => {
  await resetDatabase();
  user = await createTestUser(`approval-${Date.now()}-${Math.random()}@example.com`);
  setCurrentUser(user);
});

describe("approval resolution is single-shot and race-safe", () => {
  it("(a) resolves a pending approval once", async () => {
    const { run, agent } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);

    const res = await callResolve(approval.id, { status: "approved" });
    expect(res.status).toBe(200);

    const stored = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(stored?.status).toBe("approved");

    const job = await prisma.runJob.findFirst({ where: { workflowRunId: run.id } });
    expect(job?.status).toBe("queued");
  });

  it("(b) a replayed resolve returns 409 and changes nothing", async () => {
    const { run, agent } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);

    expect((await callResolve(approval.id, { status: "approved" })).status).toBe(200);

    const activityAfterFirst = await prisma.activityLog.count({ where: { workflowRunId: run.id } });
    const eventsAfterFirst = await prisma.productEvent.count({
      where: { userId: user.id, event: "approval_resolved" }
    });

    const second = await callResolve(approval.id, { status: "approved" });
    expect(second.status).toBe(409);

    // No second audit row, no double-counted funnel event.
    expect(await prisma.activityLog.count({ where: { workflowRunId: run.id } })).toBe(activityAfterFirst);
    expect(
      await prisma.productEvent.count({ where: { userId: user.id, event: "approval_resolved" } })
    ).toBe(eventsAfterFirst);
  });

  it("(c) two concurrent resolves: exactly one wins, one enqueue", async () => {
    const { run, agent } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);

    const [r1, r2] = await Promise.all([
      callResolve(approval.id, { status: "approved" }),
      callResolve(approval.id, { status: "approved" })
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    expect(await prisma.activityLog.count({ where: { workflowRunId: run.id } })).toBe(1);
    expect(
      await prisma.productEvent.count({ where: { userId: user.id, event: "approval_resolved" } })
    ).toBe(1);
    expect(await prisma.runJob.count({ where: { workflowRunId: run.id } })).toBe(1);
  });

  it("(d) a denied approval cannot be flipped to approved", async () => {
    const { run, agent } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);

    expect((await callResolve(approval.id, { status: "denied" })).status).toBe(200);
    expect((await prisma.approvalRequest.findUnique({ where: { id: approval.id } }))?.status).toBe("denied");

    const replay = await callResolve(approval.id, { status: "approved" });
    expect(replay.status).toBe(409);

    // The consent record still says denied.
    expect((await prisma.approvalRequest.findUnique({ where: { id: approval.id } }))?.status).toBe("denied");
  });

  it("(e) resolving never resets a job a worker has already claimed", async () => {
    const { run, agent, job } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);

    // A worker claims the job and is mid-execution with a live lease.
    await prisma.runJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        claimedBy: "worker-1",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        heartbeatAt: new Date()
      }
    });

    await callResolve(approval.id, { status: "approved" });

    const after = await prisma.runJob.findUnique({ where: { id: job.id } });
    expect(after?.status).toBe("running");
    expect(after?.claimedBy).toBe("worker-1");
  });

  it("(f) a choice intent cannot be re-answered", async () => {
    const { run, agent } = await seedPausedRun();
    const intent = await seedChoiceIntent(run.id, agent.id);

    expect((await callResolve(intent.id, { response: { selectedIds: ["a"] } })).status).toBe(200);

    const afterFirst = await prisma.approvalRequest.findUnique({ where: { id: intent.id } });
    expect(afterFirst?.status).toBe("responded");

    const second = await callResolve(intent.id, { response: { selectedIds: ["b"] } });
    expect(second.status).toBe(409);

    // The stored answer is still the one the human actually gave.
    const afterSecond = await prisma.approvalRequest.findUnique({ where: { id: intent.id } });
    expect(afterSecond?.response).toEqual(afterFirst?.response);
  });

  it("(g) a retry carrying the same Idempotency-Key replays the original outcome", async () => {
    const { run, agent } = await seedPausedRun();
    const approval = await seedApproval(run.id, agent.id);
    const key = "resolve-key-aaaaaaaaaaaaaaaa";

    const first = await callResolve(approval.id, { status: "approved" }, key);
    expect(first.status).toBe(200);

    // Same logical request retried (e.g. a dropped response) — replays, not 409.
    const retry = await callResolve(approval.id, { status: "approved" }, key);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");

    expect(await prisma.activityLog.count({ where: { workflowRunId: run.id } })).toBe(1);
  });
});
