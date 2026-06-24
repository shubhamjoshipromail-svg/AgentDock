import { prisma } from "../prisma";
import { executeExistingRun, loadRunnable, resumeRunFromLatestApproval, type RunResult } from "./run-engine";

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_PER_USER_CONCURRENCY = 1;

export type RunJobWithRun = {
  id: string;
  userId: string;
  workflowRunId: string;
  status: string;
  claimedBy: string | null;
  leaseExpiresAt: Date | null;
  workflowRun: {
    id: string;
    userId: string;
    workflowId: string;
    status: string;
  };
};

function jobStatusForRun(status: string): "paused" | "completed" | "failed" | "killed" {
  if (status === "paused_for_approval") return "paused";
  if (status === "completed") return "completed";
  if (status === "killed") return "killed";
  return "failed";
}

function terminalRunStatusForJob(status: string): string {
  if (status === "completed") return "completed";
  if (status === "killed") return "killed";
  if (status === "paused_for_approval") return "paused_for_approval";
  return status;
}

function dateAfter(ms: number): Date {
  return new Date(Date.now() + ms);
}

export async function createQueuedRun(
  userId: string,
  workflowId: string
): Promise<{ ok: true; result: RunResult } | { ok: false; status: number; message: string }> {
  const runnable = await loadRunnable(userId, workflowId);
  if (!runnable) return { ok: false, status: 404, message: "Flow not found." };
  if (runnable.agents.length === 0) return { ok: false, status: 400, message: "Flow has no agents to run." };

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowRun.create({
      data: {
        userId,
        workflowId,
        status: "queued",
        riskLevel: "medium",
        startedAt: new Date()
      }
    });

    await tx.runJob.create({
      data: {
        userId,
        workflowRunId: created.id,
        status: "queued"
      }
    });

    return created;
  });

  return { ok: true, result: { runId: run.id, status: "queued" } };
}

export async function enqueueRunJob(userId: string, runId: string): Promise<{ ok: boolean; status?: string }> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, userId: true, workflowId: true, status: true }
  });
  if (!run) return { ok: false };
  if (["completed", "halted_cost", "halted_error", "killed"].includes(run.status)) {
    return { ok: true, status: run.status };
  }

  await prisma.runJob.upsert({
    where: { workflowRunId: run.id },
    create: {
      userId,
      workflowRunId: run.id,
      status: "queued"
    },
    update: {
      status: "queued",
      claimedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      lastError: null
    }
  });

  return { ok: true, status: "queued" };
}

export async function markRunJobFailed(userId: string, runId: string, error: string): Promise<void> {
  await prisma.runJob.updateMany({
    where: { userId, workflowRunId: runId },
    data: {
      status: "failed",
      claimedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      lastError: error.slice(0, 2000)
    }
  });
}

export async function markRunJobKilled(userId: string, runId: string): Promise<void> {
  await prisma.runJob.updateMany({
    where: { userId, workflowRunId: runId },
    data: {
      status: "killed",
      claimedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: null
    }
  });
}

export async function claimNextRunJob(options: {
  workerId: string;
  leaseMs?: number;
  perUserConcurrency?: number;
}): Promise<RunJobWithRun | null> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const perUserConcurrency = options.perUserConcurrency ?? DEFAULT_PER_USER_CONCURRENCY;

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT j.id
      FROM run_jobs j
      WHERE (
        j.status = 'queued'::"RunJobStatus"
        OR (
          j.status = 'running'::"RunJobStatus"
          AND j.lease_expires_at IS NOT NULL
          AND j.lease_expires_at < NOW()
        )
      )
      AND (
        SELECT COUNT(*)
        FROM run_jobs active
        WHERE active.user_id = j.user_id
          AND active.status = 'running'::"RunJobStatus"
          AND active.lease_expires_at IS NOT NULL
          AND active.lease_expires_at > NOW()
      ) < ${perUserConcurrency}
      ORDER BY j.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const jobId = rows[0]?.id;
    if (!jobId) return null;

    return tx.runJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        claimedBy: options.workerId,
        leaseExpiresAt: dateAfter(leaseMs),
        heartbeatAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: null
      },
      include: {
        workflowRun: {
          select: {
            id: true,
            userId: true,
            workflowId: true,
            status: true
          }
        }
      }
    });
  }) as Promise<RunJobWithRun | null>;
}

export async function heartbeatRunJob(jobId: string, workerId: string, leaseMs = DEFAULT_LEASE_MS): Promise<boolean> {
  const updated = await prisma.runJob.updateMany({
    where: { id: jobId, claimedBy: workerId, status: "running" },
    data: { heartbeatAt: new Date(), leaseExpiresAt: dateAfter(leaseMs) }
  });
  return updated.count > 0;
}

export async function updateStepCursor(jobId: string, workerId: string, stepCursor: number): Promise<void> {
  await prisma.runJob.updateMany({
    where: { id: jobId, claimedBy: workerId, status: "running" },
    data: { stepCursor }
  });
}

export async function completeRunJob(jobId: string, workerId: string, result: RunResult): Promise<void> {
  const status = jobStatusForRun(result.status);
  await prisma.runJob.updateMany({
    where: { id: jobId, claimedBy: workerId },
    data: {
      status,
      claimedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
      lastError: status === "failed" ? `Run ended as ${terminalRunStatusForJob(result.status)}` : null
    }
  });
}

export async function failRunJob(jobId: string, workerId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.runJob.updateMany({
    where: { id: jobId, claimedBy: workerId },
    data: {
      status: "failed",
      claimedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
      lastError: message.slice(0, 2000)
    }
  });
}

export async function processRunJob(job: RunJobWithRun, workerId: string, leaseMs = DEFAULT_LEASE_MS): Promise<RunResult> {
  // Continuous heartbeat: extend the lease every leaseMs/3 so a long-running
  // engine (multi-agent flow) never loses its lease mid-execution. The heartbeat
  // stops on the first failure — a dead worker stops heartbeating and the job
  // becomes reclaimable after leaseExpiresAt passes.
  const heartbeatMs = Math.max(5_000, Math.floor(leaseMs / 3));
  let heartbeatError = false;
  const heartbeat = setInterval(async () => {
    const ok = await heartbeatRunJob(job.id, workerId, leaseMs);
    if (!ok) heartbeatError = true;
  }, heartbeatMs);

  try {
    if (job.workflowRun.status === "killed") {
      const result = { runId: job.workflowRunId, status: "killed" };
      await completeRunJob(job.id, workerId, result);
      return result;
    }

    // Read the current step cursor from the job row. A fresh job starts at 0;
    // a reclaimed job resumes from the last completed agent's index.
    const freshJob = await prisma.runJob.findUnique({ where: { id: job.id }, select: { stepCursor: true } });
    const stepCursor = freshJob?.stepCursor ?? 0;

    const result =
      job.workflowRun.status === "paused_for_approval"
        ? await resumeRunFromLatestApproval(job.userId, job.workflowRunId)
        : await executeExistingRun(job.userId, job.workflowRunId, {
            stepCursor,
            onAgentStepComplete: async (idx) => {
              await updateStepCursor(job.id, workerId, idx);
            }
          });

    if (heartbeatError) {
      // Heartbeat failed mid-run: the lease may have expired and another worker
      // could have claimed this job. Fail to be safe — the other worker will
      // pick it up.
      await failRunJob(job.id, workerId, new Error("Heartbeat lost mid-run; lease may have expired."));
      return { runId: job.workflowRunId, status: "halted_error" };
    }

    if (!result) {
      const failed = { runId: job.workflowRunId, status: "halted_error" };
      await failRunJob(job.id, workerId, new Error("Run could not be resumed."));
      return failed;
    }

    await completeRunJob(job.id, workerId, result);
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runWorkerOnce(options: {
  workerId: string;
  leaseMs?: number;
  perUserConcurrency?: number;
}): Promise<RunResult | null> {
  const job = await claimNextRunJob(options);
  if (!job) return null;

  try {
    return await processRunJob(job, options.workerId, options.leaseMs);
  } catch (error) {
    await failRunJob(job.id, options.workerId, error);
    throw error;
  }
}

export async function runWorkerLoop(options: {
  workerId: string;
  pollMs?: number;
  leaseMs?: number;
  perUserConcurrency?: number;
  shouldStop?: () => boolean;
}): Promise<void> {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  while (!options.shouldStop?.()) {
    const result = await runWorkerOnce(options);
    if (!result) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export const runQueueSql = {
  note:
    "Run jobs are claimed with SELECT ... FOR UPDATE SKIP LOCKED. Expired running leases are eligible for re-claim by another worker."
} satisfies Record<string, string>;
