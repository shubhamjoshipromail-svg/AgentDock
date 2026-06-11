import type { McpDefaultPermission, McpRiskLevel, McpVerificationStatus } from "../types";
import type {
  CatalogSnapshot,
  FlowPlan,
  FlowPlanAgent,
  FlowPlanApprovalGate,
  FlowPlanMemory
} from "./schema";

// A tool matched to a catalog entry but not yet clamped. clamp.ts turns this into
// a PlannedFlowTool by computing the ceiling + effective permission.
export type ResolvedTool = {
  serverName: string;
  displayName: string;
  mcpServerId: string;
  requestedPermission: McpDefaultPermission;
  recommendedPermission: McpDefaultPermission;
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
  rationale: string;
};

export type ResolvedFlow = {
  name: string;
  goal: string;
  agents: FlowPlanAgent[];
  tools: ResolvedTool[];
  memoryAttachments: FlowPlanMemory[];
  approvalGates: FlowPlanApprovalGate[];
  estimatedBudgetCents: number;
  risks: FlowPlan["risks"];
};

function lower(value: string): string {
  return value.trim().toLowerCase();
}

// Drops any agent/tool/partition the model named that does not resolve against
// the catalog snapshot (recording a warning), re-normalizes agent order to a
// contiguous 1..n, and re-points or drops approval gates whose target agent was
// removed. Never auto-creates anything — plan-time references must already exist.
export function resolvePlan(plan: FlowPlan, snapshot: CatalogSnapshot): { plan: ResolvedFlow; warnings: string[] } {
  const warnings: string[] = [];

  const agentByName = new Map(snapshot.agents.map((agent) => [lower(agent.name), agent]));
  const toolByName = new Map(snapshot.tools.map((tool) => [lower(tool.serverName), tool]));
  const partitionByName = new Map(snapshot.memory.map((partition) => [lower(partition.partitionName), partition]));

  // --- Agents: resolve, then re-normalize order ---
  const matchedAgents = plan.agents
    .map((agent) => ({ agent, match: agentByName.get(lower(agent.agentName)) }))
    .filter((entry) => {
      if (!entry.match) {
        warnings.push(`Dropped agent "${entry.agent.agentName}" — not in your agent catalog.`);
        return false;
      }
      return true;
    })
    .map((entry) => ({ original: entry.agent, canonicalName: entry.match!.name, originalOrder: entry.agent.order }));

  // Sort by the model's order, then assign contiguous 1..n preserving relative order.
  const sorted = [...matchedAgents].sort((a, b) => a.originalOrder - b.originalOrder);
  const remap = sorted.map((entry, index) => ({ ...entry, newOrder: index + 1 }));

  const agents: FlowPlanAgent[] = remap.map((entry) => ({
    agentName: entry.canonicalName,
    role: entry.original.role,
    order: entry.newOrder,
    rationale: entry.original.rationale
  }));

  // --- Tools ---
  const tools: ResolvedTool[] = [];
  for (const tool of plan.tools) {
    const match = toolByName.get(lower(tool.serverName));
    if (!match) {
      warnings.push(`Dropped tool "${tool.serverName}" — not in the available tool catalog.`);
      continue;
    }
    tools.push({
      serverName: tool.serverName,
      displayName: match.displayName,
      mcpServerId: match.id,
      requestedPermission: tool.requestedPermission,
      recommendedPermission: match.recommendedPermission,
      riskLevel: match.riskLevel,
      verificationStatus: match.verificationStatus,
      rationale: tool.rationale
    });
  }

  // --- Memory ---
  const memoryAttachments: FlowPlanMemory[] = [];
  for (const attachment of plan.memoryAttachments) {
    const match = partitionByName.get(lower(attachment.partitionName));
    if (!match) {
      warnings.push(`Dropped memory "${attachment.partitionName}" — not one of your memory partitions.`);
      continue;
    }
    memoryAttachments.push({ ...attachment, partitionName: match.partitionName });
  }

  // --- Approval gates: re-point afterAgentOrder onto the renumbered agents ---
  const approvalGates: FlowPlanApprovalGate[] = [];
  for (const gate of plan.approvalGates) {
    if (remap.length === 0) {
      warnings.push(`Dropped approval gate "${gate.trigger}" — no agents remain to anchor it.`);
      continue;
    }
    const exact = remap.find((entry) => entry.originalOrder === gate.afterAgentOrder);
    if (exact) {
      approvalGates.push({ ...gate, afterAgentOrder: exact.newOrder });
      continue;
    }
    // Nearest remaining agent by the model's original order.
    const nearest = remap.reduce((best, entry) =>
      Math.abs(entry.originalOrder - gate.afterAgentOrder) < Math.abs(best.originalOrder - gate.afterAgentOrder) ? entry : best
    );
    warnings.push(
      `Re-pointed approval gate "${gate.trigger}" from agent order ${gate.afterAgentOrder} to ${nearest.newOrder} (original target removed).`
    );
    approvalGates.push({ ...gate, afterAgentOrder: nearest.newOrder });
  }

  return {
    plan: {
      name: plan.name,
      goal: plan.goal,
      agents,
      tools,
      memoryAttachments,
      approvalGates,
      estimatedBudgetCents: plan.estimatedBudgetCents,
      risks: plan.risks
    },
    warnings
  };
}
