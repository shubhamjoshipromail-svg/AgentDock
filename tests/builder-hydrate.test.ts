import { describe, expect, it } from "vitest";

import { workflowToBuilderNodes } from "../components/build/serialize";
import type { PersistedWorkflow } from "../lib/types";

function server(id: string, displayName: string) {
  return {
    id,
    name: `reg:test.org/${id}`,
    displayName,
    description: "d",
    registrySource: "mcp-official-registry",
    verificationStatus: "verified" as const,
    riskLevel: "low" as const,
    recommendedPermission: "read_only" as const,
    category: "Tool"
  };
}

function baseWorkflow(): PersistedWorkflow {
  return {
    id: "wf-1",
    name: "Flow",
    goal: "Do the thing.",
    status: "active",
    weeklyBudgetCents: 500,
    maxRunBudgetCents: 100,
    approvalMode: "manual",
    workflowAgents: [
      { id: "wa-2", roleInWorkflow: "Second", routeOrder: 2, defaultMode: "Auto", agent: { id: "ag-2", name: "Second Agent", provider: "Claude", category: "Research" } },
      { id: "wa-1", roleInWorkflow: "First", routeOrder: 1, defaultMode: "Auto", agent: { id: "ag-1", name: "First Agent", provider: "OpenAI", category: "Discovery" } }
    ],
    workflowMcps: [
      { id: "wm-a", purpose: "search", defaultPermission: "read_only", mcpServer: server("srv-a", "Tool A") }
    ],
    mcpAccessGrants: [
      { id: "gr-a", canRead: true, canWrite: false, canExecute: false, canDelete: false, requiresApproval: false, mcpServer: server("srv-a", "Tool A") }
    ],
    memoryPartitions: [{ id: "mp-1", name: "Job Memory", sensitivityLevel: "medium" }]
  };
}

describe("workflowToBuilderNodes — canvas hydrates from persisted state", () => {
  it("emits a goal, agents in routeOrder, tools, and memory", () => {
    const nodes = workflowToBuilderNodes(baseWorkflow());

    expect(nodes.map((n) => n.type)).toEqual(["goal", "agent", "agent", "mcp", "memory"]);
    // Agents are ordered by routeOrder, not array order.
    expect(nodes.filter((n) => n.type === "agent").map((n) => n.name)).toEqual(["First Agent", "Second Agent"]);
    // Goal node carries the persisted goal text.
    expect(nodes[0].attachments).toEqual(["Do the thing."]);
    // Tool node is backed by the persisted server + grant.
    const tool = nodes.find((n) => n.type === "mcp");
    expect(tool?.name).toBe("Tool A");
    expect(tool?.id).toBe("mcp-srv-a");
  });

  it("a tool with no backing workflowMcp row is NOT drawn (persisted rows are source of truth)", () => {
    const wf = baseWorkflow();
    // A stale grant exists, but the workflowMcp row is gone (e.g. tool removed).
    wf.workflowMcps = [];
    const nodes = workflowToBuilderNodes(wf);
    expect(nodes.some((n) => n.type === "mcp")).toBe(false);
  });

  it("reflects approval-required grants on the tool node", () => {
    const wf = baseWorkflow();
    wf.mcpAccessGrants = [
      { id: "gr-a", canRead: true, canWrite: false, canExecute: false, canDelete: false, requiresApproval: true, mcpServer: server("srv-a", "Tool A") }
    ];
    const tool = workflowToBuilderNodes(wf).find((n) => n.type === "mcp");
    expect(tool?.permissions).toContain("approval required");
    expect(tool?.approvalMode).toBe("Approval gated");
  });

  it("handles a flow with no tools or memory (just goal + agents)", () => {
    const wf = baseWorkflow();
    wf.workflowMcps = [];
    wf.mcpAccessGrants = [];
    wf.memoryPartitions = [];
    const nodes = workflowToBuilderNodes(wf);
    expect(nodes.map((n) => n.type)).toEqual(["goal", "agent", "agent"]);
  });
});
