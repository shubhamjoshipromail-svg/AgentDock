import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as archiveWorkflow } from "../app/api/workflows/[workflowId]/archive/route";
import { GET as listWorkflows } from "../app/api/workflows/route";
import { loadRunnable } from "../lib/execution/run-engine";

async function seedFlow(userId: string, name = "Archive me") {
  const agent = await prisma.agent.create({
    data: { userId, name: `${name} agent`, category: "c", provider: "p", verified: true, description: "d", systemPrompt: "s", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name, goal: "g", status: "active", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "run", routeOrder: 1, defaultMode: "auto" }
  });
  return workflow;
}

function archiveRequest(id: string) {
  return archiveWorkflow(new Request(`http://localhost/api/workflows/${id}/archive`, { method: "POST" }), {
    params: Promise.resolve({ workflowId: id })
  });
}

describe("E5 — flow archive lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  it("soft-archives an owned flow, hides it from listings, and prevents new runs", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const workflow = await seedFlow(user.id);

    const response = await archiveRequest(workflow.id);
    expect(response.status).toBe(200);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe("archived");
    expect(await prisma.workflow.count({ where: { id: workflow.id } })).toBe(1);

    const listed = await (await listWorkflows()).json();
    expect(listed.workflows.map((flow: { id: string }) => flow.id)).not.toContain(workflow.id);
    expect(await loadRunnable(user.id, workflow.id)).toBeNull();
  });

  it("does not let another user archive the flow", async () => {
    const owner = await createTestUser("archive-owner@example.com");
    const other = await createTestUser("archive-other@example.com");
    const workflow = await seedFlow(owner.id);
    setCurrentUser(other);

    expect((await archiveRequest(workflow.id)).status).toBe(404);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe("active");
  });

  it("refuses to hide a flow while one of its runs is active", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const workflow = await seedFlow(user.id);
    await prisma.workflowRun.create({
      data: { userId: user.id, workflowId: workflow.id, status: "paused_for_approval", riskLevel: "medium" }
    });

    expect((await archiveRequest(workflow.id)).status).toBe(409);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).status).toBe("active");
  });
});
