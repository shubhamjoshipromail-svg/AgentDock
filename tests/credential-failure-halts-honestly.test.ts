import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";

// ============================================================================
// A CREDENTIAL FAILURE IS A REFUSAL, NOT A CRASH (Chunk 24 Phase 1b).
//
// Observed in production: a user approved a real send, the engine re-checked the
// approval and passed, then the Google OAuth refresh returned `invalid_grant`
// (the refresh token had expired). That error was THROWN rather than returned:
// it escaped executeAllowedTool -- which expects an { ok: false } result -- rose
// through processRunJob, killed the worker process, and left the run pinned at
// "running" forever. Railway restarted the worker, it re-claimed the same job,
// and crashed again (attemptCount reached 3).
//
// Two independent guarantees close that:
//   1. the broker converts a failed credential load into a legible refusal;
//   2. an unexpected error in a job halts the RUN and does not kill the worker.
// ============================================================================

import { brokerCredentialForAction, registerCredentialProvider } from "../lib/execution/credential-broker";
import { failRunTerminally } from "../lib/execution/run-engine";
import { runWorkerOnce } from "../lib/execution/run-queue";

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createTestUser(`cred-${Date.now()}-${Math.random()}@example.com`);
});

describe("the broker turns a credential failure into a refusal", () => {
  it("an expired OAuth grant is refused with a reconnect instruction, not thrown", async () => {
    const restore = registerCredentialProvider("google", async () => {
      throw new Error("invalid_grant");
    });
    try {
      const outcome = await brokerCredentialForAction("google", user.id, {
        external: true,
        mandate: { scope: "gmail:send_email", limitCents: null, expiresAt: null, revokedAt: null },
        requiredScope: "gmail:send_email",
        amountCents: 0
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        // Must name the remedy: this is a reconnect, not a permissions problem.
        expect(outcome.reason).toMatch(/expired or was revoked/i);
        expect(outcome.reason).toMatch(/profile/i);
      }
    } finally {
      restore();
    }
  });

  it("an unexpected provider error is still a refusal, never an exception", async () => {
    const restore = registerCredentialProvider("google", async () => {
      throw new Error("socket hang up");
    });
    try {
      const outcome = await brokerCredentialForAction("google", user.id, {
        external: true,
        mandate: { scope: "gmail:send_email", limitCents: null, expiresAt: null, revokedAt: null },
        requiredScope: "gmail:send_email"
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toMatch(/could not obtain/i);
    } finally {
      restore();
    }
  });
});

describe("a failed job halts its run and leaves the worker alive", () => {
  async function seedQueuedRun() {
    const workflow = await prisma.workflow.create({
      data: {
        userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500,
        maxRunBudgetCents: 100, approvalMode: "approval_gated"
      }
    });
    // Deliberately NO workflowAgent: loadRunnable finds no agents, which is the
    // simplest way to drive the job down an error path through the real queue.
    const run = await prisma.workflowRun.create({
      data: {
        userId: user.id, workflowId: workflow.id, status: "queued",
        riskLevel: "medium", startedAt: new Date(), idempotencyKey: `k-${Math.random()}`
      }
    });
    await prisma.runJob.create({ data: { userId: user.id, workflowRunId: run.id, status: "queued" } });
    return run;
  }

  it("failRunTerminally ends a dangling run and resolves its pending intents", async () => {
    const run = await seedQueuedRun();
    await prisma.workflowRun.update({ where: { id: run.id }, data: { status: "running" } });
    const intent = await prisma.approvalRequest.create({
      data: {
        userId: user.id, workflowRunId: run.id, intentType: "approval",
        title: "t", description: "d", actionType: "email_send", riskLevel: "medium",
        status: "pending", stepIndex: 0, scope: "gmail:send_email"
      }
    });

    await failRunTerminally(run.id, "invalid_grant");

    const after = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("halted_error");
    expect(after.endedAt).not.toBeNull();

    // No orphaned approval card left behind on a terminal run.
    const afterIntent = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: intent.id } });
    expect(afterIntent.status).not.toBe("pending");

    // The reason is recorded, not swallowed.
    const blocked = await prisma.workflowRunEvent.findFirst({
      where: { workflowRunId: run.id, eventType: "action_blocked" },
      orderBy: { createdAt: "desc" }
    });
    expect(blocked?.description).toMatch(/invalid_grant/);
  });

  it("it refuses to resurrect or re-end an already-terminal run", async () => {
    const run = await seedQueuedRun();
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: "completed", endedAt: new Date(), resultText: "real deliverable" }
    });

    await failRunTerminally(run.id, "late error");

    const after = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("completed");
    expect(after.resultText).toBe("real deliverable");
  });

  it("runWorkerOnce does not throw, so one bad job cannot kill the worker", async () => {
    const run = await seedQueuedRun();

    // Must not reject: a throw here unwinds runWorkerLoop and exits the process.
    const result = await runWorkerOnce({ workerId: "w-crash-test" });
    expect(result).not.toBeNull();

    // And the run must not be left dangling for a user to stare at.
    const after = await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(["halted_error", "completed", "killed"]).toContain(after.status);
    expect(after.endedAt).not.toBeNull();

    // The worker can still claim afterwards — the loop is alive.
    const next = await runWorkerOnce({ workerId: "w-crash-test" });
    expect(next).toBeNull();
  });
});
