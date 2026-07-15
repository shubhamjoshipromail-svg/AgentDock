import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { PATCH as patchMcpGrant } from "../app/api/mcp/grants/[id]/route";
import { POST as simulateRun } from "../app/api/workflow-runs/simulate/route";
import { POST as createWorkflow } from "../app/api/workflows/route";
import { createFlowSchema } from "../lib/validation/schemas";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("Zod input validation", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("rejects create-flow bodies with missing or wrong-typed fields", async () => {
    const missingGoal = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Flow",
      weeklyBudgetCents: 500,
      maxRunBudgetCents: 100,
      approvalMode: "manual"
    }));
    expect(missingGoal.status).toBe(400);
    const missingGoalData = await missingGoal.json();
    expect(missingGoalData.message).toBeTruthy();
    expect(Array.isArray(missingGoalData.issues)).toBe(true);

    const badBudget = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Flow",
      goal: "Goal",
      weeklyBudgetCents: "five hundred",
      maxRunBudgetCents: 100,
      approvalMode: "manual"
    }));
    expect(badBudget.status).toBe(400);

    const badApprovalMode = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Flow",
      goal: "Goal",
      weeklyBudgetCents: 500,
      maxRunBudgetCents: 100,
      approvalMode: "yolo"
    }));
    expect(badApprovalMode.status).toBe(400);
  });

  // E3 — a plan/save must never persist a placeholder ("Describe an outcome…")
  // as the goal or name. The schema rejects placeholder goals and derives a real
  // name from the goal when the name itself is a placeholder.
  describe("E3 — placeholder goal/name guard", () => {
    const base = { weeklyBudgetCents: 500, maxRunBudgetCents: 150, approvalMode: "manual" as const };

    it("rejects a placeholder goal", () => {
      const r = createFlowSchema.safeParse({ name: "Describe an outcome…", goal: "Describe an outcome…", ...base });
      expect(r.success).toBe(false);
    });

    it("rejects an ellipsis-only goal", () => {
      expect(createFlowSchema.safeParse({ name: "x", goal: "…", ...base }).success).toBe(false);
    });

    it("derives the name from the goal when the name is a placeholder", () => {
      const r = createFlowSchema.safeParse({
        name: "Describe an outcome…",
        goal: "Research the history of tea in Japan and summarize it.",
        ...base
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.name).toBe("Research the history of tea in Japan and summarize it");
    });

    it("keeps a real, user-provided name", () => {
      const r = createFlowSchema.safeParse({ name: "Tea Research", goal: "Research tea history.", ...base });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.name).toBe("Tea Research");
    });
  });

  it("rejects simulate bodies without a UUID workflowId", async () => {
    const missing = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", {}));
    expect(missing.status).toBe(400);

    const notUuid = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", { workflowId: "not-a-uuid" }));
    expect(notUuid.status).toBe(400);

    const invalidJson = await simulateRun(new Request("http://localhost/api/workflow-runs/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json"
    }));
    expect(invalidJson.status).toBe(400);
  });

  it("rejects tool grant patches with wrong-typed fields", async () => {
    const response = await patchMcpGrant(
      new Request("http://localhost/api/mcp/grants/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canRead: "yes" })
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(Array.isArray(data.issues)).toBe(true);
  });
});
