import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import { bannerState, isRichIntent, sortNewestFirst } from "../lib/attention/pending";
import type { PendingIntentSummary } from "../lib/api/client";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { GET as listPending } from "../app/api/approvals/route";

// ---- helpers ----

function summary(over: Partial<PendingIntentSummary>): PendingIntentSummary {
  return {
    id: "i1", intentType: "approval", payload: null, title: "t", description: "d",
    requestedAt: new Date().toISOString(), runId: "r1", runStatus: "paused_for_approval",
    flowId: "f1", flowName: "Flow One", agentName: "Agent",
    ...over
  };
}

async function seedRunWithIntent(userId: string, opts: {
  flowName?: string;
  runStatus?: "paused_for_approval" | "running" | "killed" | "completed";
  intentStatus?: "pending" | "approved" | "denied";
  intentType?: string;
  requestedAt?: Date;
} = {}) {
  const workflow = await prisma.workflow.create({
    data: { userId, name: opts.flowName ?? "Attention Flow", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  const run = await prisma.workflowRun.create({
    data: { userId, workflowId: workflow.id, status: opts.runStatus ?? "paused_for_approval", riskLevel: "medium" }
  });
  const intent = await prisma.approvalRequest.create({
    data: {
      userId, workflowRunId: run.id,
      intentType: opts.intentType ?? "approval",
      title: "Send the email?", description: "to: you",
      actionType: "email_send", riskLevel: "medium",
      status: opts.intentStatus ?? "pending",
      requestedAt: opts.requestedAt ?? new Date()
    }
  });
  return { workflow, run, intent };
}

// ---- pure selectors: the ONE derivation banner/queue/window share ----

describe("attention selectors — banner state derives from pending intents", () => {
  it("no pending intents → no banner", () => {
    expect(bannerState([])).toEqual({ visible: false });
  });

  it("one pending → names the flow and targets that intent", () => {
    const s = bannerState([summary({ id: "a", flowName: "Research Flow" })]);
    expect(s.visible).toBe(true);
    if (!s.visible) throw new Error("unreachable");
    expect(s.count).toBe(1);
    expect(s.label).toContain("Research Flow");
    expect(s.newest.id).toBe("a");
  });

  it("several pending → shows the count and targets the NEWEST", () => {
    const old = summary({ id: "old", requestedAt: new Date(Date.now() - 60_000).toISOString() });
    const fresh = summary({ id: "fresh", requestedAt: new Date().toISOString() });
    const s = bannerState([old, fresh]);
    if (!s.visible) throw new Error("banner must be visible");
    expect(s.count).toBe(2);
    expect(s.label).toContain("2");
    expect(s.newest.id).toBe("fresh");
    // sort helper is what the queue renders with — newest first.
    expect(sortNewestFirst([old, fresh]).map((i) => i.id)).toEqual(["fresh", "old"]);
  });

  it("rich intents (choice/form/confirmation) get the focused window; approval stays one-click inline", () => {
    expect(isRichIntent("choice")).toBe(true);
    expect(isRichIntent("form")).toBe(true);
    expect(isRichIntent("confirmation")).toBe(true);
    expect(isRichIntent("approval")).toBe(false);
    expect(isRichIntent(null)).toBe(false);
  });
});

// ---- the pending-intents source: GET /api/approvals ----

describe("GET /api/approvals — the one pending-intents source", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  it("401 when signed out", async () => {
    const res = await listPending();
    expect(res.status).toBe(401);
  });

  it("lists only PENDING intents on LIVE runs, newest first, with flow/agent context", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    const a = await seedRunWithIntent(user.id, { flowName: "Older Ask", requestedAt: new Date(Date.now() - 120_000) });
    const b = await seedRunWithIntent(user.id, { flowName: "Newest Ask", intentType: "choice", requestedAt: new Date() });
    // Noise that must NEVER summon the user:
    await seedRunWithIntent(user.id, { flowName: "Resolved", intentStatus: "approved" });
    await seedRunWithIntent(user.id, { flowName: "Dead Run", runStatus: "killed" });
    await seedRunWithIntent(user.id, { flowName: "Finished Run", runStatus: "completed" });

    const res = await listPending();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.intents).toHaveLength(2);
    expect(data.intents.map((i: { id: string }) => i.id)).toEqual([b.intent.id, a.intent.id]);
    expect(data.intents[0]).toMatchObject({
      intentType: "choice",
      flowName: "Newest Ask",
      runId: b.run.id,
      title: "Send the email?"
    });
    // Context the window header needs is present without a second fetch.
    expect(typeof data.intents[0].requestedAt).toBe("string");
  });

  it("never leaks another user's pending intents", async () => {
    const user = await createTestUser();
    const other = await createTestUser("someone-else@example.com", "Someone Else");
    await seedRunWithIntent(other.id, { flowName: "Other Person's" });
    setCurrentUser(user);

    const res = await listPending();
    const data = await res.json();
    expect(data.intents).toHaveLength(0);
  });
});
