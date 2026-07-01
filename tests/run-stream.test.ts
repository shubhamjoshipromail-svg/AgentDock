import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import { isTerminalRunStatus, TERMINAL_RUN_STATUSES } from "../lib/runs/terminal";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { GET as streamRun } from "../app/api/runs/[id]/stream/route";

describe("terminal run statuses (single source of truth)", () => {
  it("recognizes exactly the terminal statuses and nothing else", () => {
    for (const s of TERMINAL_RUN_STATUSES) expect(isTerminalRunStatus(s)).toBe(true);
    for (const s of ["running", "queued", "paused_for_approval", "", "weird"]) expect(isTerminalRunStatus(s)).toBe(false);
    expect(isTerminalRunStatus(null)).toBe(false);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });
});

async function readStream(res: Response, until: (text: string) => boolean, maxMs = 15_000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (value) acc += decoder.decode(value, { stream: true });
    if (until(acc)) break;
    if (done) break;
  }
  await reader.cancel().catch(() => undefined);
  return acc;
}

describe("run SSE stream — status truth, not invented", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  async function seedCompletedRun(userId: string) {
    const workflow = await prisma.workflow.create({
      data: { userId, name: "Streamed Flow", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
    });
    const run = await prisma.workflowRun.create({
      data: { userId, workflowId: workflow.id, status: "completed", riskLevel: "medium", totalCostCents: 4, stepCount: 2, toolCallCount: 1, resultText: "Here is your result." }
    });
    await prisma.workflowRunEvent.create({
      data: { workflowRunId: run.id, userId, eventType: "mcp_tool_use", title: "web_search (real)", description: "searched", decision: "allowed" }
    });
    return run;
  }

  it("streams a run_snapshot with authoritative status/counts/result, then a run_terminal", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const run = await seedCompletedRun(user.id);

    const res = await streamRun(new Request(`http://localhost/api/runs/${run.id}/stream`), { params: Promise.resolve({ id: run.id }) });
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await readStream(res, (t) => t.includes("run_terminal"));
    // Snapshot carries the DB truth (not invented by the client).
    expect(text).toContain("\"type\":\"run_snapshot\"");
    expect(text).toContain("\"status\":\"completed\"");
    expect(text).toContain("\"totalCostCents\":4");
    expect(text).toContain("\"resultText\":\"Here is your result.\"");
    // The append-only event was streamed.
    expect(text).toContain("web_search (real)");
    // And a terminal marker so the client stops on its own.
    expect(text).toContain("\"type\":\"run_terminal\"");
    expect(text).toContain("\"status\":\"completed\"");
  });

  it("404s a run the user does not own (no stream leaks across users)", async () => {
    const owner = await createTestUser("owner@example.com");
    const run = await seedCompletedRun(owner.id);
    const other = await createTestUser("other@example.com");
    setCurrentUser(other);
    const res = await streamRun(new Request(`http://localhost/api/runs/${run.id}/stream`), { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(404);
  });
});
