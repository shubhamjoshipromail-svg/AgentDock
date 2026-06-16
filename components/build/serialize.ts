import type { SaveFlowInput } from "../../lib/api/client";
import type { BuilderNode, McpDefaultPermission, PersistedWorkflow } from "../../lib/types";

// Default budgets/approval used when the canvas has no explicit control node.
// (There is no budget UI yet; these match the prior demo caps.)
const DEFAULT_WEEKLY_BUDGET_CENTS = 500;
const DEFAULT_MAX_RUN_BUDGET_CENTS = 150;

function deriveFlowName(goal: string): string {
  const firstLine = goal.split("\n")[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/[.!?]/)[0]?.trim() ?? "";
  const candidate = firstSentence || firstLine;

  if (!candidate) {
    return "Untitled Flow";
  }

  return candidate.length > 60 ? `${candidate.slice(0, 57)}...` : candidate;
}

// Build the create payload from the real Builder canvas state instead of any
// hardcoded constant: chosen agents + order + roles, memory attachments,
// approval gates (-> approvalMode), goal text, and the serialized node layout.
export function serializeBuilderFlow(goal: string, nodes: BuilderNode[]): SaveFlowInput {
  const agentNodes = nodes.filter((node) => node.type === "agent");
  const memoryNodes = nodes.filter((node) => node.type === "memory");
  const hasApprovalGate = nodes.some((node) => node.type === "control");

  return {
    name: deriveFlowName(goal),
    goal: goal.trim() || "Untitled flow goal.",
    weeklyBudgetCents: DEFAULT_WEEKLY_BUDGET_CENTS,
    maxRunBudgetCents: DEFAULT_MAX_RUN_BUDGET_CENTS,
    approvalMode: hasApprovalGate ? "approval_gated" : "manual",
    agents: agentNodes.map((node, index) => ({
      agentName: node.name,
      roleInWorkflow: node.category ?? "Agent",
      routeOrder: index + 1,
      defaultMode: node.approvalMode
    })),
    memory: memoryNodes.map((node) => ({ partitionName: node.name })),
    // Persist the full node list so the future visual builder can restore positions.
    layout: { nodes }
  };
}

function permissionLabel(permission: McpDefaultPermission): string {
  return `${permission.replaceAll("_", " ")} permission`;
}

// Hydrate the canvas from the PERSISTED workflow, not from any saved layout blob.
// This is the Chunk 8 "flow truth" contract: reopening a flow must show exactly
// the agents, tools, and grants that will execute. Persisted rows are the source
// of truth — a tool with no backing workflowMcp row is never drawn, and grant
// state (not the model's request) describes each tool node.
export function workflowToBuilderNodes(workflow: PersistedWorkflow): BuilderNode[] {
  const goalNode: BuilderNode = {
    id: "goal",
    name: "User Goal",
    type: "goal",
    category: "Workflow intent",
    permissions: "Defines requested outcome",
    memoryAccess: "No direct memory access",
    budgetImpact: "$0.00",
    approvalMode: "User-authored",
    attachments: [workflow.goal]
  };

  const agentNodes: BuilderNode[] = [...workflow.workflowAgents]
    .sort((a, b) => a.routeOrder - b.routeOrder)
    .map((wa) => ({
      id: `agent-${wa.agent.id}`,
      name: wa.agent.name,
      type: "agent",
      provider: wa.agent.provider,
      category: wa.agent.category,
      permissions: wa.roleInWorkflow,
      memoryAccess: "Per-grant memory access",
      budgetImpact: "Metadata only",
      approvalMode: wa.defaultMode,
      attachments: []
    }));

  // Grants keyed by server so each tool node reflects its real, current grant.
  const grantByServer = new Map((workflow.mcpAccessGrants ?? []).map((g) => [g.mcpServer.id, g]));

  const toolNodes: BuilderNode[] = (workflow.workflowMcps ?? []).map((wm) => {
    const grant = grantByServer.get(wm.mcpServer.id);
    const permission = grant?.requiresApproval
      ? "approval required permission"
      : permissionLabel(wm.defaultPermission);
    return {
      id: `mcp-${wm.mcpServer.id}`,
      name: wm.mcpServer.displayName,
      type: "mcp",
      category: wm.mcpServer.category ?? "Tool",
      riskLevel: wm.mcpServer.riskLevel,
      permissions: permission,
      memoryAccess: "No memory access by default",
      budgetImpact: "$0.00 metadata only",
      approvalMode: grant && !grant.requiresApproval ? "Allowed inside flow scope" : "Approval gated",
      attachments: wm.purpose ? [wm.purpose] : []
    };
  });

  const memoryNodes: BuilderNode[] = (workflow.memoryPartitions ?? []).map((partition) => ({
    id: `memory-${partition.id}`,
    name: partition.name,
    type: "memory",
    category: "Memory zone",
    permissions: "Scoped to this flow",
    memoryAccess: partition.sensitivityLevel ? `${partition.sensitivityLevel} sensitivity` : "Flow-scoped",
    budgetImpact: "$0.00",
    approvalMode: "Firewall enforced",
    attachments: []
  }));

  return [goalNode, ...agentNodes, ...toolNodes, ...memoryNodes];
}
