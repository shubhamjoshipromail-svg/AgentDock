import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as createWorkflow } from "../app/api/workflows/route";
import { loadRunnable } from "../lib/execution/run-engine";
import { repairLegacyOrchestratorToolOwners } from "../lib/orchestrator/tool-ownership";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
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
      // Executable canonical identity so the grant guard accepts it. Both rows
      // resolve to the seeded, enabled `search` registration; distinct tool
      // names keep them as separate canonical identities.
      mcpServerKey: "search",
      mcpToolName: slug
    }
  });
}

function flowPayload(tools: { mcpServerId: string }[]) {
  return {
    name: "Flow Truth",
    goal: "The engine must run exactly what was last saved.",
    weeklyBudgetCents: 500,
    maxRunBudgetCents: 100,
    approvalMode: "manual" as const,
    agents: [{ agentName: "Job Discovery Agent", roleInWorkflow: "Discover", routeOrder: 1, defaultMode: "Auto" }],
    tools
  };
}

async function save(body: unknown) {
  const res = await createWorkflow(jsonRequest("http://localhost/api/workflows", body));
  expect(res.status).toBe(201);
  return res.json();
}

// The set the engine loads for a run = the union of allowed tools across agents,
// by mcp server id. This is what deny-by-default gates against.
function loadedServerIds(runnable: Awaited<ReturnType<typeof loadRunnable>>): Set<string> {
  const ids = new Set<string>();
  for (const agent of runnable?.agents ?? []) {
    for (const tool of agent.allowedTools) ids.add(tool.server.id);
  }
  return ids;
}

describe("flow truth — authored == stored == executed", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("the engine loads exactly the last-saved tool set; a removed tool is unavailable", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const serverA = await makeServer("tool-a");
    const serverB = await makeServer("tool-b");

    // Save with both tools, then run-load via the engine.
    const first = await save(flowPayload([{ mcpServerId: serverA.id }, { mcpServerId: serverB.id }]));
    const workflowId = first.workflow.id as string;

    const before = await loadRunnable(user.id, workflowId);
    const beforeIds = loadedServerIds(before);
    expect(beforeIds.has(serverA.id)).toBe(true);
    expect(beforeIds.has(serverB.id)).toBe(true);

    // Re-save with tool B removed.
    await save(flowPayload([{ mcpServerId: serverA.id }]));

    // The engine now CANNOT use tool B — no grant survives, so deny-by-default
    // leaves it out of the runnable tool set entirely.
    const after = await loadRunnable(user.id, workflowId);
    const afterIds = loadedServerIds(after);
    expect(afterIds.has(serverA.id)).toBe(true);
    expect(afterIds.has(serverB.id)).toBe(false);

    // And the grant itself is gone from the database.
    expect(await prisma.mcpAccessGrant.findFirst({ where: { workflowId, mcpServerId: serverB.id } })).toBeNull();
  });

  it("an orchestrated tool grant is visible only to its owning agent", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const firstAgent = await prisma.agent.create({
      data: { userId: user.id, name: "Scoped Researcher", category: "Research", provider: "p", verified: true, description: "d", systemPrompt: "research", model: "m" }
    });
    const secondAgent = await prisma.agent.create({
      data: { userId: user.id, name: "Scoped Sender", category: "Comms", provider: "p", verified: true, description: "d", systemPrompt: "send", model: "m" }
    });
    const search = await makeServer("owned-search");
    const delivery = await makeServer("owned-delivery");

    const saved = await save({
      name: "Scoped tools",
      goal: "Research once and deliver once.",
      weeklyBudgetCents: 500,
      maxRunBudgetCents: 100,
      approvalMode: "approval_gated",
      agents: [
        { agentId: firstAgent.id, roleInWorkflow: "Research", routeOrder: 1, defaultMode: "Auto" },
        { agentId: secondAgent.id, roleInWorkflow: "Deliver", routeOrder: 2, defaultMode: "Auto" }
      ],
      tools: [
        { mcpServerId: search.id, agentId: firstAgent.id },
        { mcpServerId: delivery.id, agentId: secondAgent.id }
      ]
    });
    const runnable = await loadRunnable(user.id, saved.workflow.id as string);

    expect(runnable?.agents[0].allowedTools.map((tool) => tool.server.id)).toEqual([search.id]);
    expect(runnable?.agents[1].allowedTools.map((tool) => tool.server.id)).toEqual([delivery.id]);
    const grants = await prisma.mcpAccessGrant.findMany({ where: { workflowId: saved.workflow.id }, orderBy: { createdAt: "asc" } });
    expect(grants.map((grant) => grant.agentId)).toEqual([firstAgent.id, secondAgent.id]);
  });

  it("safely scopes legacy orchestrator grants that were saved workflow-wide", async () => {
    const user = await createTestUser();
    const firstAgent = await prisma.agent.create({
      data: { userId: user.id, name: "Legacy Researcher", category: "Research", provider: "p", verified: true, description: "d", systemPrompt: "research", model: "m" }
    });
    const lastAgent = await prisma.agent.create({
      data: { userId: user.id, name: "Legacy Sender", category: "Comms", provider: "p", verified: true, description: "d", systemPrompt: "send", model: "m" }
    });
    const search = await makeServer("legacy-search");
    const delivery = await makeServer("legacy-delivery");
    await prisma.mcpServer.update({
      where: { id: delivery.id },
      data: { recommendedPermission: "approval_required", isExternalSend: true }
    });
    const workflow = await prisma.workflow.create({
      data: {
        userId: user.id, name: "Legacy orchestrated", goal: "Research and deliver.", weeklyBudgetCents: 500,
        maxRunBudgetCents: 100, approvalMode: "approval_gated",
        layout: {
          source: "orchestrator",
          plan: { tools: [
            { mcpServerId: search.id, effectivePermission: "read_only" },
            { mcpServerId: delivery.id, effectivePermission: "approval_required" }
          ] }
        }
      }
    });
    await prisma.workflowAgent.createMany({ data: [
      { workflowId: workflow.id, agentId: firstAgent.id, roleInWorkflow: "Research", routeOrder: 1, defaultMode: "Auto" },
      { workflowId: workflow.id, agentId: lastAgent.id, roleInWorkflow: "Deliver", routeOrder: 2, defaultMode: "Auto" }
    ] });
    await prisma.mcpAccessGrant.createMany({ data: [
      { userId: user.id, workflowId: workflow.id, mcpServerId: search.id, canRead: true, requiresApproval: false },
      { userId: user.id, workflowId: workflow.id, mcpServerId: delivery.id, canWrite: true, requiresApproval: true }
    ] });

    const runnable = await loadRunnable(user.id, workflow.id);
    expect(runnable?.agents[0].allowedTools.map((tool) => tool.server.id)).toEqual([search.id]);
    expect(runnable?.agents[1].allowedTools.map((tool) => tool.server.id)).toEqual([delivery.id]);

    expect(await repairLegacyOrchestratorToolOwners(user.id)).toBe(2);
    const repaired = await prisma.mcpAccessGrant.findMany({ where: { workflowId: workflow.id } });
    expect(repaired.find((grant) => grant.mcpServerId === search.id)?.agentId).toBe(firstAgent.id);
    expect(repaired.find((grant) => grant.mcpServerId === delivery.id)?.agentId).toBe(lastAgent.id);
    expect(await repairLegacyOrchestratorToolOwners(user.id)).toBe(0);
  });
});
