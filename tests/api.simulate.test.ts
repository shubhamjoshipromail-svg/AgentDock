import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as simulateRun } from "../app/api/workflow-runs/simulate/route";
import { POST as createWorkflow } from "../app/api/workflows/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body)
  });
}

async function createServer(name: string, displayName: string, riskLevel: "low" | "medium" | "high" | "restricted") {
  return prisma.mcpServer.create({
    data: {
      name,
      displayName,
      description: `${displayName} for tests`,
      registrySource: "test",
      riskLevel,
      verificationStatus: "verified",
      // Executable canonical identity so the grant guard accepts it. Resolves to
      // the seeded, enabled `search` registration; the tool name keeps each row a
      // distinct canonical identity. (These tests assert grant/decision mechanics,
      // not tool output.)
      mcpServerKey: "search",
      mcpToolName: name,
      isExternalSend: false
    }
  });
}

describe("Generic flow persistence + simulation (Phase E)", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("persists and simulates an arbitrary (non-job-search) flow from real saved data", async () => {
    // Two arbitrary agents (not the job-search defaults are required, but use
    // arbitrary names + roles) and one tool.
    const tool = await createServer("billing-mcp", "Billing MCP", "low");

    const createResponse = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Invoice Triage",
      goal: "Triage incoming invoices and flag anomalies for review.",
      weeklyBudgetCents: 400,
      maxRunBudgetCents: 90,
      approvalMode: "manual",
      agents: [
        { agentName: "Ledger Agent", roleInWorkflow: "Read ledger", routeOrder: 1, defaultMode: "Autonomous" },
        { agentName: "Anomaly Agent", roleInWorkflow: "Flag anomalies", routeOrder: 2, defaultMode: "Review" }
      ],
      tools: [{ mcpServerId: tool.id, defaultPermission: "read_only" }]
    }));
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const workflowId = created.workflow.id as string;

    // Agents created under this user, not the shared/global namespace.
    const ledger = await prisma.agent.findFirst({ where: { name: "Ledger Agent" } });
    expect(ledger?.userId).toBeTruthy();
    expect(created.workflow.workflowAgents).toHaveLength(2);
    expect(created.workflow.workflowMcps).toHaveLength(1);

    const simResponse = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", { workflowId }));
    expect(simResponse.status).toBe(201);
    const sim = await simResponse.json();
    const events = sim.workflowRun.events as { title: string; agent: { name: string } | null; mcpTool: string | null; decision: string }[];

    // Events reference exactly the agents and tool we built with.
    const agentEventNames = events.filter((e) => e.agent).map((e) => e.agent!.name).sort();
    expect(agentEventNames).toEqual(["Anomaly Agent", "Ledger Agent"]);

    const toolEvent = events.find((e) => e.mcpTool === "Billing MCP");
    expect(toolEvent).toBeTruthy();
    // read_only grant has a capability and no approval => allowed.
    expect(toolEvent!.decision).toBe("allowed");

    // No job-search strings leaked into the persisted run.
    expect(events.some((e) => /job search|Job Discovery/i.test(e.title))).toBe(false);
  });

  it("derives tool-event decision from the grant permission (blocked tool => blocked event + no approval)", async () => {
    const blockedTool = await createServer("payments-mcp", "Payments MCP", "restricted");

    const createResponse = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Payments Flow",
      goal: "Watch payment events.",
      weeklyBudgetCents: 200,
      maxRunBudgetCents: 50,
      approvalMode: "manual",
      agents: [{ agentName: "Watcher Agent", roleInWorkflow: "Watch", routeOrder: 1, defaultMode: "Auto" }],
      tools: [{ mcpServerId: blockedTool.id, defaultPermission: "blocked" }]
    }));
    const created = await createResponse.json();

    const simResponse = await simulateRun(jsonRequest("http://localhost/api/workflow-runs/simulate", { workflowId: created.workflow.id }));
    const sim = await simResponse.json();
    const toolEvent = (sim.workflowRun.events as { mcpTool: string | null; decision: string }[]).find((e) => e.mcpTool === "Payments MCP");
    expect(toolEvent!.decision).toBe("blocked");
    // Blocked tool produces no pending approval.
    expect(sim.workflowRun.approvalRequests).toHaveLength(0);
  });

  it("saving two different builds yields two structurally different flows", async () => {
    const a = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Flow A",
      goal: "Goal A",
      weeklyBudgetCents: 100,
      maxRunBudgetCents: 30,
      approvalMode: "manual",
      agents: [{ agentName: "Alpha Agent", roleInWorkflow: "A", routeOrder: 1, defaultMode: "Auto" }]
    }));
    const b = await createWorkflow(jsonRequest("http://localhost/api/workflows", {
      name: "Flow B",
      goal: "Goal B",
      weeklyBudgetCents: 700,
      maxRunBudgetCents: 200,
      approvalMode: "approval_gated",
      agents: [
        { agentName: "Beta Agent", roleInWorkflow: "B1", routeOrder: 1, defaultMode: "Auto" },
        { agentName: "Gamma Agent", roleInWorkflow: "B2", routeOrder: 2, defaultMode: "Review" }
      ]
    }));

    const flowA = (await a.json()).workflow;
    const flowB = (await b.json()).workflow;
    expect(flowA.id).not.toBe(flowB.id);
    expect(flowA.workflowAgents).toHaveLength(1);
    expect(flowB.workflowAgents).toHaveLength(2);
    expect(await prisma.workflow.count()).toBe(2);
  });
});
