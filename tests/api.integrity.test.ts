import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as bootstrap } from "../app/api/bootstrap/route";
import { GET as getMemory } from "../app/api/memory/route";
import { PATCH as patchMemoryGrant } from "../app/api/memory/grants/[id]/route";
import { GET as getWorkflows, POST as createWorkflow } from "../app/api/workflows/route";

const flowPayload = {
  name: "Test Flow",
  goal: "Goal",
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 100,
  approvalMode: "manual",
  agents: [
    { agentName: "Job Discovery Agent", roleInWorkflow: "Discover", routeOrder: 1, defaultMode: "Auto" }
  ]
};

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function tableCounts() {
  const [agents, workflows, partitions, items, grants, logs] = await Promise.all([
    prisma.agent.count(),
    prisma.workflow.count(),
    prisma.memoryPartition.count(),
    prisma.memoryItem.count(),
    prisma.memoryAccessGrant.count(),
    prisma.memoryAccessLog.count()
  ]);
  return { agents, workflows, partitions, items, grants, logs };
}

describe("Phase D data-model integrity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("isolates agents, flows, memory, and grants between users", async () => {
    const userA = await createTestUser("a@example.com", "User A");
    const userB = await createTestUser("b@example.com", "User B");

    setCurrentUser(userA);
    await bootstrap();
    await createWorkflow(jsonRequest("http://localhost/api/workflows", flowPayload));

    const agentsAfterA = await prisma.agent.findMany({ where: { userId: userA.id } });
    expect(agentsAfterA.length).toBeGreaterThan(0);

    setCurrentUser(userB);
    await bootstrap();

    // B sees only B's data.
    const workflowsResponse = await getWorkflows();
    const workflowsData = await workflowsResponse.json();
    expect(workflowsData.workflows.every((workflow: { userId: string }) => workflow.userId === userB.id)).toBe(true);
    expect(workflowsData.workflows.some((workflow: { name: string }) => workflow.name === "Test Flow")).toBe(false);

    const memoryResponse = await getMemory();
    const memoryData = await memoryResponse.json();
    expect(memoryData.partitions.every((partition: { userId: string }) => partition.userId === userB.id)).toBe(true);

    // B's bootstrap/upserts never touched A's agent rows.
    const agentsAfterB = await prisma.agent.findMany({ where: { userId: userA.id } });
    expect(new Map(agentsAfterB.map((agent) => [agent.id, agent.updatedAt.toISOString()]))).toEqual(
      new Map(agentsAfterA.map((agent) => [agent.id, agent.updatedAt.toISOString()]))
    );

    // Same agent name exists separately per user.
    const discoveryAgents = await prisma.agent.findMany({ where: { name: "Job Discovery Agent" } });
    expect(discoveryAgents).toHaveLength(2);
    expect(new Set(discoveryAgents.map((agent) => agent.userId))).toEqual(new Set([userA.id, userB.id]));

    // B cannot mutate A's memory grants.
    const grantOfA = await prisma.memoryAccessGrant.findFirst({ where: { userId: userA.id } });
    expect(grantOfA).not.toBeNull();
    const patchResponse = await patchMemoryGrant(
      jsonRequest(`http://localhost/api/memory/grants/${grantOfA!.id}`, { canRead: false }, "PATCH"),
      { params: Promise.resolve({ id: grantOfA!.id }) }
    );
    expect(patchResponse.status).toBe(404);
  });

  it("bootstrap is idempotent across repeated calls", async () => {
    setCurrentUser(await createTestUser());

    const first = await bootstrap();
    expect(first.status).toBe(200);
    const countsAfterFirst = await tableCounts();

    const second = await bootstrap();
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.bootstrapped).toBe(false);
    expect(await tableCounts()).toEqual(countsAfterFirst);
  });

  it("GET /api/workflows and GET /api/memory do not create data", async () => {
    setCurrentUser(await createTestUser());

    const before = await tableCounts();

    const workflowsResponse = await getWorkflows();
    expect(workflowsResponse.status).toBe(200);
    expect((await workflowsResponse.json()).workflows).toEqual([]);

    const memoryResponse = await getMemory();
    expect(memoryResponse.status).toBe(200);
    expect((await memoryResponse.json()).partitions).toEqual([]);

    expect(await tableCounts()).toEqual(before);
  });
});
