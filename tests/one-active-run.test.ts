import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { createQueuedRun } from "../lib/execution/run-queue";

// ============================================================================
// ONE ACTIVE RUN PER (USER, FLOW) — AND IT IS A DATABASE OBJECT (Chunk 22 Phase 4).
//
// Chunk 20 established this as a partial unique index. Chunk 21 DROPPED it the very
// next migration, because the index as written could not express the reviewed
// `allowConcurrent` escape hatch, and replaced it with a 10-second wall-clock
// window. A run paused for approval for longer than ten seconds could then be
// started again — two concurrent runs of one flow, each burning the key, each able
// to raise its own approval and perform the same external action.
//
// The invariant is restored as a constraint the database enforces, with the escape
// hatch expressed IN the predicate rather than by weakening it: the index covers
// only runs that did not deliberately opt out.
// ============================================================================

const ACTIVE = ["queued", "running", "pending", "waiting_for_approval", "paused_for_approval"] as const;

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createTestUser(`oar-${Date.now()}-${Math.random()}@example.com`);
  setCurrentUser(user);
});

async function seedFlow() {
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
  return workflow;
}

function activeCount(workflowId: string) {
  return prisma.workflowRun.count({
    where: { userId: user.id, workflowId, status: { in: [...ACTIVE] } }
  });
}

describe("one active run per flow is enforced without a timing window", () => {
  it("a run paused for longer than the old 10s window still blocks a second run", async () => {
    const workflow = await seedFlow();

    const first = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000001" });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unexpected");

    // The run has been sitting paused for approval for a few minutes — exactly the
    // case the wall-clock window failed to cover.
    await prisma.workflowRun.update({
      where: { id: first.result.runId },
      data: { status: "paused_for_approval", createdAt: new Date(Date.now() - 5 * 60_000) }
    });

    // A different click carries a different key, so idempotency cannot help here.
    const second = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000002" });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unexpected");

    expect(second.result.runId).toBe(first.result.runId);
    expect(await activeCount(workflow.id)).toBe(1);
  });

  it("the database itself refuses a second active run, not just the application", async () => {
    const workflow = await seedFlow();
    const first = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000003" });
    if (!first.ok) throw new Error("unexpected");

    // Bypass every application-level check and insert straight into the table.
    // If the guarantee is only application logic, this succeeds and the invariant
    // is a convention. It must be rejected by a constraint.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "workflow_runs" ("id","user_id","workflow_id","status","started_at","risk_level","created_at","updated_at","total_cost_cents","step_count","tool_call_count","allow_concurrent")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'queued', NOW(), 'medium', NOW(), NOW(), 0, 0, 0, false)`,
        user.id,
        workflow.id
      )
    ).rejects.toThrow();

    expect(await activeCount(workflow.id)).toBe(1);
  });

  it("the constraint exists as a database object", async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'workflow_runs' AND indexname = 'workflow_runs_active_per_flow_unique'`
    );
    // If a future migration drops this index, THIS test fails loudly rather than
    // the invariant silently decaying into application logic again.
    expect(rows).toHaveLength(1);
  });

  it("concurrent creates from two separate clicks still yield one active run", async () => {
    const workflow = await seedFlow();

    const results = await Promise.all([
      createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000010" }),
      createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000011" }),
      createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000012" })
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.flatMap((r) => (r.ok ? [r.result.runId] : [])));
    expect(ids.size).toBe(1);
    expect(await activeCount(workflow.id)).toBe(1);
  });

  it("allowConcurrent remains the one deliberate way to run a flow twice", async () => {
    const workflow = await seedFlow();

    const first = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000020" });
    const blocked = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000021" });
    const explicit = await createQueuedRun(user.id, workflow.id, {
      idempotencyKey: "oar-key-0000000000022",
      allowConcurrent: true
    });

    expect(first.ok && blocked.ok && explicit.ok).toBe(true);
    if (!first.ok || !blocked.ok || !explicit.ok) throw new Error("unexpected");

    expect(blocked.result.runId).toBe(first.result.runId);
    expect(explicit.result.runId).not.toBe(first.result.runId);
    expect(await activeCount(workflow.id)).toBe(2);
  });

  it("a new run is allowed once the previous one is terminal", async () => {
    const workflow = await seedFlow();
    const first = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000030" });
    if (!first.ok) throw new Error("unexpected");

    await prisma.workflowRun.update({
      where: { id: first.result.runId },
      data: { status: "completed", endedAt: new Date() }
    });

    const second = await createQueuedRun(user.id, workflow.id, { idempotencyKey: "oar-key-0000000000031" });
    if (!second.ok) throw new Error("unexpected");

    expect(second.result.runId).not.toBe(first.result.runId);
    expect(await activeCount(workflow.id)).toBe(1);
  });
});
