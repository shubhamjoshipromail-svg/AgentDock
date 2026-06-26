import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as resolveApproval } from "../app/api/approvals/[id]/resolve/route";
import { POST as simulateRun } from "../app/api/workflow-runs/simulate/route";
import { POST as createWorkflow } from "../app/api/workflows/route";

const workflowPayload = {
  name: "Job Search Automation",
  goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 150,
  approvalMode: "approval_gated",
  agents: [
    { agentName: "Job Discovery Agent", roleInWorkflow: "Discover roles", routeOrder: 1, defaultMode: "Autonomous discovery" },
    { agentName: "Outreach Draft Agent", roleInWorkflow: "Draft outreach", routeOrder: 2, defaultMode: "Draft-only" }
  ]
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function saveWorkflow() {
  const response = await createWorkflow(jsonRequest("http://localhost/api/workflows", workflowPayload));
  expect(response.status).toBe(201);
  const data = await response.json();
  return data.workflow as { id: string };
}

// Generic simulate only emits an approval when an approval-gated tool is attached;
// this helper saves a flow with one so the approval-path assertions hold.
async function saveWorkflowWithApprovalTool() {
  const server = await prisma.mcpServer.create({
    data: {
      name: "gmail-draft-test",
      displayName: "Gmail Draft MCP",
      description: "Draft-only email tool for tests.",
      registrySource: "test",
      riskLevel: "high",
      verificationStatus: "verified",
      // Executable canonical identity so the grant guard accepts it.
      mcpServerKey: "gmail",
      mcpToolName: "create_draft",
      isExternalSend: false
    }
  });

  const response = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
    ...workflowPayload,
    tools: [{ mcpServerId: server.id, defaultPermission: "draft_only" }]
  }));
  expect(response.status).toBe(201);
  const data = await response.json();
  return data.workflow as { id: string };
}

describe("API sanity (regression net)", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("rejects workflow creation when signed out", async () => {
    setCurrentUser(null);
    const response = await createWorkflow(jsonRequest("http://localhost/api/workflows", workflowPayload));
    expect(response.status).toBe(401);
  });

  it("POST /api/workflows creates a workflow with agents", async () => {
    const workflow = await saveWorkflow();

    const stored = await prisma.workflow.findUnique({
      where: { id: workflow.id },
      include: { workflowAgents: true }
    });
    expect(stored?.name).toBe("Job Search Automation");
    expect(stored?.workflowAgents).toHaveLength(2);
  });

  it("POST /api/workflow-runs/simulate creates a run with events and approvals", async () => {
    const workflow = await saveWorkflowWithApprovalTool();

    const response = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", { workflowId: workflow.id }));
    expect(response.status).toBe(201);
    const data = await response.json();

    const run = await prisma.workflowRun.findUnique({
      where: { id: data.workflowRun.id },
      include: { events: true, approvalRequests: true }
    });
    expect(run).not.toBeNull();
    expect(run!.events.length).toBeGreaterThan(0);
    expect(run!.approvalRequests.length).toBeGreaterThan(0);
  });

  it("POST /api/approvals/[id]/resolve updates approval status", async () => {
    const workflow = await saveWorkflowWithApprovalTool();
    const simulateResponse = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", { workflowId: workflow.id }));
    const simulateData = await simulateResponse.json();
    const approval = simulateData.workflowRun.approvalRequests[0] as { id: string };

    const response = await resolveApproval(
      jsonRequest(`http://localhost/api/approvals/${approval.id}/resolve`, { status: "approved" }),
      { params: Promise.resolve({ id: approval.id }) }
    );
    expect(response.status).toBe(200);

    const stored = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(stored?.status).toBe("approved");
    expect(stored?.resolvedAt).not.toBeNull();
  });
});
