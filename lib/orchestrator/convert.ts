import type { CreateFlowInput } from "../validation/schemas";
import type { PlannedFlow } from "./schema";

const DEFAULT_WEEKLY_BUDGET_CENTS = 500;

// Maps a resolved + clamped plan onto the existing create-workflow payload so the
// save path (POST /api/workflows) is reused untouched. Tools attach by resolved
// id with the clamped effective permission — never the model's requested value.
export function planToSaveInput(plan: PlannedFlow): CreateFlowInput {
  // estimatedBudgetCents may be 0; the create schema requires positive budgets.
  const weeklyBudgetCents = plan.estimatedBudgetCents > 0 ? plan.estimatedBudgetCents : DEFAULT_WEEKLY_BUDGET_CENTS;
  const maxRunBudgetCents = Math.max(1, Math.ceil(weeklyBudgetCents / 3));

  return {
    name: plan.name,
    goal: plan.goal,
    weeklyBudgetCents,
    maxRunBudgetCents,
    approvalMode: plan.approvalGates.length > 0 ? "approval_gated" : "manual",
    agents: plan.agents.map((agent) => ({
      // Bind by stable catalog id (authoritative); name accompanies for display.
      agentId: agent.agentId,
      agentName: agent.agentName,
      roleInWorkflow: agent.role,
      routeOrder: agent.order,
      defaultMode: "Plan-scoped"
    })),
    tools: plan.tools.map((tool) => ({
      mcpServerId: tool.mcpServerId,
      agentId: plan.agents.find((agent) => agent.order === tool.agentOrder)?.agentId,
      purpose: tool.rationale,
      defaultPermission: tool.effectivePermission
    })),
    memory: plan.memoryAttachments
      .map((attachment) => ({ partitionName: attachment.partitionName ?? "" }))
      .filter((attachment) => attachment.partitionName.length > 0),
    // Persist the plan so the future visual builder can restore it.
    layout: { source: "orchestrator", plan: plan as unknown as Record<string, unknown> }
  };
}
