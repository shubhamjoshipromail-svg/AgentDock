import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma, resetDatabase, createTestUser } from "./helpers/db";

// Model mock: a queue of fake completions shared by every run in this file.
const llm = vi.hoisted(() => ({ queue: [] as { text: string }[], calls: 0 }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llm.calls += 1;
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: 1 };
    })
  }))
}));

import { executeExistingRun, resumeRunFromLatestApproval } from "../lib/execution/run-engine";
import { claimNextRunJob, runWorkerOnce } from "../lib/execution/run-queue";

// ============================================================================
// THE QUEUE IS THE ONLY WAY IN (Chunk 22 Phase 3).
//
// The duplication family survived because the race-proof queued path was barely
// exercised: ~40 test call sites drove the engine directly, so the seam where
// production races actually live was certified by nothing. The engine now demands
// a live queue lease, which makes "resume goes through the queue" a runtime
// invariant instead of a convention.
// ============================================================================

const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  llm.queue = [];
  llm.calls = 0;
  user = await createTestUser(`queue-${Date.now()}-${Math.random()}@example.com`);
});

async function seedQueuedRun() {
  const agent = await prisma.agent.create({
    data: {
      userId: user.id, name: `A-${Math.random()}`, category: "c", provider: "p",
      verified: true, description: "d", systemPrompt: "Answer.", model: "claude-sonnet-4-6"
    }
  });
  const workflow = await prisma.workflow.create({
    data: {
      userId: user.id, name: "F", goal: "Say hello.", weeklyBudgetCents: 500,
      maxRunBudgetCents: 100, approvalMode: "approval_gated"
    }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" }
  });
  const run = await prisma.workflowRun.create({
    data: {
      userId: user.id, workflowId: workflow.id, status: "queued",
      riskLevel: "medium", startedAt: new Date(), idempotencyKey: `run-${Math.random()}`
    }
  });
  const job = await prisma.runJob.create({
    data: { userId: user.id, workflowRunId: run.id, status: "queued" }
  });
  return { run, job, workflow, agent };
}

describe("execution requires a live queue lease", () => {
  it("refuses a direct executeExistingRun with no lease", async () => {
    const { run, job } = await seedQueuedRun();

    await expect(
      executeExistingRun(user.id, run.id, { lease: { jobId: job.id, workerId: "not-the-holder" } })
    ).rejects.toThrow(/does not hold a live queue lease/i);
  });

  it("refuses a direct resume with no lease", async () => {
    const { run, job } = await seedQueuedRun();

    await expect(
      resumeRunFromLatestApproval(user.id, run.id, { jobId: job.id, workerId: "not-the-holder" })
    ).rejects.toThrow(/does not hold a live queue lease/i);
  });

  it("refuses a lease whose claim has expired", async () => {
    const { run, job } = await seedQueuedRun();
    await prisma.runJob.update({
      where: { id: job.id },
      data: { status: "running", claimedBy: "w1", leaseExpiresAt: new Date(Date.now() - 1_000) }
    });

    await expect(
      executeExistingRun(user.id, run.id, { lease: { jobId: job.id, workerId: "w1" } })
    ).rejects.toThrow(/does not hold a live queue lease/i);
  });

  it("accepts the lease a real claim produces", async () => {
    llm.queue = [{ text: FINAL("hello") }];
    await seedQueuedRun();

    const claimed = await claimNextRunJob({ workerId: "w1" });
    expect(claimed).not.toBeNull();

    const result = await executeExistingRun(claimed!.userId, claimed!.workflowRunId, {
      lease: { jobId: claimed!.id, workerId: "w1" }
    });
    expect(result.status).toBe("completed");
  });
});

describe("concurrent workers cannot double-execute one run", () => {
  it("two workers racing the same queued run produce exactly one execution", async () => {
    // Only ONE completion is queued: a second execution would throw
    // "no queued completion" and surface as a halted run.
    llm.queue = [{ text: FINAL("only once") }];
    const { run } = await seedQueuedRun();

    const [a, b] = await Promise.all([
      runWorkerOnce({ workerId: "worker-a" }),
      runWorkerOnce({ workerId: "worker-b" })
    ]);

    // Exactly one worker got the job; the other found nothing to claim.
    const claimed = [a, b].filter((r) => r !== null);
    expect(claimed).toHaveLength(1);

    // Exactly one model call — the run executed once, not twice.
    expect(llm.calls).toBe(1);

    const fresh = await prisma.workflowRun.findUnique({ where: { id: run.id } });
    expect(fresh?.status).toBe("completed");

    // And exactly one terminal completion event.
    expect(
      await prisma.workflowRunEvent.count({
        where: { workflowRunId: run.id, eventType: "workflow_completed" }
      })
    ).toBe(1);
  });
});

describe("no code path bypasses the queue", () => {
  // A source-level assertion is the right tool here because the property being
  // asserted IS static: "no module outside the queue reaches these entry points".
  // It is not a stand-in for behaviour — the behaviour is covered by the lease
  // tests above.
  const ROOT = path.resolve(__dirname, "..");
  const SCAN_DIRS = ["app", "lib", "servers", "tests", "scripts"];
  const ALLOWED = new Set([
    path.join("lib", "execution", "run-queue.ts"), // the queue itself
    path.join("lib", "execution", "run-engine.ts"), // where they are defined
    path.join("tests", "queue-only-resume.test.ts") // this guard
  ]);

  function sourceFiles(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    let entries: string[] = [];
    try {
      entries = readdirSync(abs);
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const full = path.join(abs, entry);
      if (statSync(full).isDirectory()) return sourceFiles(path.join(dir, entry));
      return /\.(ts|tsx|js|mjs)$/.test(entry) ? [path.join(dir, entry)] : [];
    });
  }

  it("only the queue reaches the lease-guarded execution entry points", () => {
    const offenders = SCAN_DIRS.flatMap(sourceFiles)
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /executeExistingRun|resumeRunFromLatestApproval/.test(readFileSync(path.join(ROOT, rel), "utf8")));

    expect(
      offenders,
      `These files bypass the durable queue. Drive runs through claimNextRunJob/processRunJob ` +
        `(tests: use tests/helpers/queue.ts) instead:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("resumeAfterApproval is not exported at all", () => {
    const engine = readFileSync(path.join(ROOT, "lib", "execution", "run-engine.ts"), "utf8");
    expect(engine).toMatch(/async function resumeAfterApproval\(/);
    expect(engine).not.toMatch(/export\s+async\s+function\s+resumeAfterApproval\(/);
  });
});
