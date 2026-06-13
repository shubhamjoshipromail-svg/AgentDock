import type { SaveFlowInput } from "../../lib/api/client";
import type { BuilderNode } from "../../lib/types";

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
