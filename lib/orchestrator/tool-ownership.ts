import { prisma } from "../prisma";

type PersistedPlanTool = {
  mcpServerId?: unknown;
  agentOrder?: unknown;
  effectivePermission?: unknown;
};

// Durable compatibility repair for orchestrator flows saved before tools had an
// owning agent. Bootstrap calls this after sign-in so the database, Workspace
// UI, and runtime all agree: reads belong to the first agent; write/send tools
// belong to the final agent unless the persisted plan names an explicit order.
export async function repairLegacyOrchestratorToolOwners(userId: string): Promise<number> {
  const workflows = await prisma.workflow.findMany({
    where: { userId },
    include: {
      workflowAgents: { orderBy: { routeOrder: "asc" } },
      mcpAccessGrants: { where: { agentId: null }, include: { mcpServer: true } }
    }
  });
  let repaired = 0;
  for (const workflow of workflows) {
    const layout = workflow.layout as { source?: unknown; plan?: { tools?: unknown } } | null;
    if (layout?.source !== "orchestrator" || workflow.workflowAgents.length === 0) continue;
    const plannedTools = Array.isArray(layout.plan?.tools) ? layout.plan.tools as PersistedPlanTool[] : [];
    const first = workflow.workflowAgents[0];
    const last = workflow.workflowAgents[workflow.workflowAgents.length - 1];
    for (const grant of workflow.mcpAccessGrants) {
      const planned = plannedTools.find((tool) => tool.mcpServerId === grant.mcpServerId);
      const explicitOrder = typeof planned?.agentOrder === "number" ? planned.agentOrder : null;
      const owner = explicitOrder === null
        ? ((planned?.effectivePermission ?? grant.mcpServer.recommendedPermission) === "read_only" && !grant.mcpServer.isExternalSend ? first : last)
        : workflow.workflowAgents.find((entry) => entry.routeOrder === explicitOrder) ?? last;
      const updated = await prisma.mcpAccessGrant.updateMany({
        where: { id: grant.id, agentId: null },
        data: { agentId: owner.agentId }
      });
      repaired += updated.count;
    }
  }
  return repaired;
}
