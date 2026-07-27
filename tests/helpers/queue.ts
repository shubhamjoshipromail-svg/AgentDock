import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { enqueueRunJob, runWorkerOnce } from "../../lib/execution/run-queue";
import type { RunResult } from "../../lib/execution/run-engine";

// ============================================================================
// DRIVE RUNS THE WAY PRODUCTION DOES (Chunk 22 Phase 3).
//
// The engine refuses to execute without a live queue lease, so tests reach it the
// same way the worker does: enqueue, then let a worker claim and process the job.
//
// Why these helpers write approval status directly instead of calling the resolve
// route: the route needs a per-file auth mock, and its own behaviour (status
// precondition, 409 on replay, no reset of a claimed job) is covered end-to-end in
// tests/approval-resolution-idempotency.test.ts. These helpers reproduce exactly
// what that route does to the data, so the seam under test here is the QUEUE.
// ============================================================================

let workerSeq = 0;
function nextWorkerId(prefix = "test-worker"): string {
  workerSeq += 1;
  return `${prefix}-${workerSeq}`;
}

// Claim and process queued jobs until the queue is empty (or the cap is hit).
// Returns the last RunResult a worker produced.
export async function drainRunQueue(
  options: { workerId?: string; maxJobs?: number } = {}
): Promise<RunResult | null> {
  const workerId = options.workerId ?? nextWorkerId();
  const maxJobs = options.maxJobs ?? 10;
  let last: RunResult | null = null;

  for (let i = 0; i < maxJobs; i += 1) {
    const result = await runWorkerOnce({ workerId });
    if (!result) break;
    last = result;
  }

  return last;
}

// Resolve an interaction intent exactly as POST /api/approvals/[id]/resolve does,
// then let the queue execute the resumption.
//
// approved=false mirrors the route's denial path: the route halts the run itself
// and never enqueues, so the engine never sees a denied intent.
export async function resumeThroughQueue(
  userId: string,
  approvalId: string,
  approved = true
): Promise<RunResult | null> {
  const approval = await prisma.approvalRequest.findFirstOrThrow({
    where: { id: approvalId, userId },
    include: { workflowRun: true }
  });
  const isApproval = !approval.intentType || approval.intentType === "approval";

  if (isApproval && !approved) {
    await prisma.approvalRequest.updateMany({
      where: { id: approvalId, status: "pending" },
      data: { status: "denied", resolvedAt: new Date() }
    });
    await prisma.workflowRunEvent.create({
      data: {
        workflowRunId: approval.workflowRunId,
        userId,
        agentId: approval.agentId,
        eventType: "action_blocked",
        title: "Approval denied",
        description: "Human denied the requested action. Run halted.",
        decision: "denied",
        actorType: "human",
        actorId: userId,
        authorityRef: approval.id,
        schemaVersion: 1,
        metadata: { source: "approval_resolution", status: "denied", executed: false }
      }
    });
    await prisma.workflowRun.update({
      where: { id: approval.workflowRunId },
      data: { status: "halted_error", endedAt: new Date() }
    });
    await prisma.approvalRequest.updateMany({
      where: { workflowRunId: approval.workflowRunId, status: "pending" },
      data: { status: "expired", resolvedAt: new Date() }
    });
    await prisma.runJob.updateMany({
      where: { workflowRunId: approval.workflowRunId },
      data: { status: "failed", claimedBy: null, leaseExpiresAt: null }
    });
    return { runId: approval.workflowRunId, status: "halted_error" };
  }

  await prisma.approvalRequest.updateMany({
    where: { id: approvalId, status: "pending" },
    data: {
      status: isApproval ? "approved" : "responded",
      resolvedAt: new Date()
    }
  });

  await enqueueRunJob(userId, approval.workflowRunId);
  return drainRunQueue();
}

// Answer a choice/form/confirmation intent with a concrete response, then resume
// through the queue.
export async function respondThroughQueue(
  userId: string,
  intentId: string,
  response: Record<string, unknown>
): Promise<RunResult | null> {
  await prisma.approvalRequest.updateMany({
    where: { id: intentId, userId, status: "pending" },
    data: { status: "responded", response: response as Prisma.InputJsonValue, resolvedAt: new Date() }
  });
  const intent = await prisma.approvalRequest.findFirstOrThrow({
    where: { id: intentId, userId },
    select: { workflowRunId: true }
  });
  await enqueueRunJob(userId, intent.workflowRunId);
  return drainRunQueue();
}

// Resume whatever the run's latest resolved intent is, through the queue.
// Mirrors what a worker does when it picks up a paused run.
export async function resumeLatestThroughQueue(userId: string, runId: string): Promise<RunResult | null> {
  await enqueueRunJob(userId, runId);
  return drainRunQueue();
}

// Execute an already-created (queued) run through the queue.
export async function executeThroughQueue(userId: string, runId: string): Promise<RunResult | null> {
  await enqueueRunJob(userId, runId);
  return drainRunQueue();
}
