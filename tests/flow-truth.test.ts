import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as createWorkflow } from "../app/api/workflows/route";
import { loadRunnable } from "../lib/execution/run-engine";

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
});
