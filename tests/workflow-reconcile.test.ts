import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as createWorkflow } from "../app/api/workflows/route";

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body)
  });
}

async function makeServer(slug: string) {
  return prisma.mcpServer.create({
    data: {
      name: `reg:test.org/${slug}`,
      displayName: slug,
      description: `${slug} server`,
      registrySource: "mcp-official-registry",
      registryId: `test.org/${slug}`,
      riskLevel: "low",
      verificationStatus: "verified",
      recommendedPermission: "read_only",
      // Executable canonical identity so the grant guard accepts it (all resolve
      // to the seeded, enabled `search` registration; distinct tool names keep
      // them separate canonical identities).
      mcpServerKey: "search",
      mcpToolName: slug
    }
  });
}

function flowPayload(tools: { mcpServerId: string }[], memory: { partitionName: string }[] = []) {
  return {
    name: "Reconcile Flow",
    goal: "Prove the executed set equals the authored set.",
    weeklyBudgetCents: 500,
    maxRunBudgetCents: 100,
    approvalMode: "manual" as const,
    agents: [{ agentName: "Job Discovery Agent", roleInWorkflow: "Discover", routeOrder: 1, defaultMode: "Auto" }],
    tools,
    memory
  };
}

async function save(body: unknown) {
  const res = await createWorkflow(jsonRequest("http://localhost/api/workflows", body));
  expect(res.status).toBe(201);
  return res.json();
}

describe("Chunk 8 — save reconciles removed tools, grants, and memory", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("removing a tool on re-save deletes its workflowMcp AND its access grant", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const serverA = await makeServer("tool-a");
    const serverB = await makeServer("tool-b");

    // Save with both tools.
    const first = await save(flowPayload([{ mcpServerId: serverA.id }, { mcpServerId: serverB.id }]));
    const workflowId = first.workflow.id as string;

    expect(await prisma.workflowMcp.count({ where: { workflowId } })).toBe(2);
    expect(await prisma.mcpAccessGrant.count({ where: { workflowId } })).toBe(2);

    // Re-save the same flow with only tool A.
    await save(flowPayload([{ mcpServerId: serverA.id }]));

    // Tool B is fully gone — attachment and grant.
    expect(await prisma.workflowMcp.findFirst({ where: { workflowId, mcpServerId: serverB.id } })).toBeNull();
    expect(await prisma.mcpAccessGrant.findFirst({ where: { workflowId, mcpServerId: serverB.id } })).toBeNull();

    // Tool A survives, with exactly one grant (no duplicate accumulation).
    expect(await prisma.workflowMcp.findFirst({ where: { workflowId, mcpServerId: serverA.id } })).not.toBeNull();
    expect(await prisma.mcpAccessGrant.count({ where: { workflowId, mcpServerId: serverA.id } })).toBe(1);
  });

  it("re-saving repeatedly never accumulates duplicate grants for a kept tool", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const serverA = await makeServer("tool-a");

    const first = await save(flowPayload([{ mcpServerId: serverA.id }]));
    const workflowId = first.workflow.id as string;
    await save(flowPayload([{ mcpServerId: serverA.id }]));
    await save(flowPayload([{ mcpServerId: serverA.id }]));

    expect(await prisma.mcpAccessGrant.count({ where: { workflowId, mcpServerId: serverA.id } })).toBe(1);
  });

  it("emptying the canvas removes every tool + grant for the flow", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const serverA = await makeServer("tool-a");

    const first = await save(flowPayload([{ mcpServerId: serverA.id }]));
    const workflowId = first.workflow.id as string;

    await save(flowPayload([]));

    expect(await prisma.workflowMcp.count({ where: { workflowId } })).toBe(0);
    expect(await prisma.mcpAccessGrant.count({ where: { workflowId } })).toBe(0);
  });

  it("a save that omits tools entirely leaves separately-attached tools intact", async () => {
    // Canvas saves (serializeBuilderFlow) omit `tools`; tools attach via the
    // dedicated endpoint. Such a save must NOT wipe attached tools.
    const user = await createTestUser();
    setCurrentUser(user);
    const serverA = await makeServer("tool-a");

    const first = await save(flowPayload([{ mcpServerId: serverA.id }]));
    const workflowId = first.workflow.id as string;
    expect(await prisma.mcpAccessGrant.count({ where: { workflowId } })).toBe(1);

    // Re-save the same flow with NO `tools` key at all.
    const body = flowPayload([]) as Record<string, unknown>;
    delete body.tools;
    await save(body);

    expect(await prisma.workflowMcp.count({ where: { workflowId } })).toBe(1);
    expect(await prisma.mcpAccessGrant.count({ where: { workflowId } })).toBe(1);
  });

  it("removing a memory partition on re-save un-scopes it from the flow", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const p1 = await prisma.memoryPartition.create({
      data: { userId: user.id, name: "Partition One", type: "workflow", sensitivityLevel: "medium", description: "d", defaultAccessPolicy: "workflow_scoped" }
    });
    const p2 = await prisma.memoryPartition.create({
      data: { userId: user.id, name: "Partition Two", type: "workflow", sensitivityLevel: "medium", description: "d", defaultAccessPolicy: "workflow_scoped" }
    });

    const first = await save(flowPayload([], [{ partitionName: "Partition One" }, { partitionName: "Partition Two" }]));
    const workflowId = first.workflow.id as string;

    expect((await prisma.memoryPartition.findUniqueOrThrow({ where: { id: p1.id } })).workflowId).toBe(workflowId);
    expect((await prisma.memoryPartition.findUniqueOrThrow({ where: { id: p2.id } })).workflowId).toBe(workflowId);

    // Re-save with only P1.
    await save(flowPayload([], [{ partitionName: "Partition One" }]));

    expect((await prisma.memoryPartition.findUniqueOrThrow({ where: { id: p1.id } })).workflowId).toBe(workflowId);
    expect((await prisma.memoryPartition.findUniqueOrThrow({ where: { id: p2.id } })).workflowId).toBeNull();
  });
});
