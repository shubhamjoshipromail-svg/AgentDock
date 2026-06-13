import { agents, builderControls, mcpTools, memoryPartitions } from "../mock-data";
import type { BuilderNode, BuilderPaletteTab } from "../../lib/types";

export function getBuilderPaletteItems(tab: BuilderPaletteTab): BuilderNode[] {
  if (tab === "Agents") {
    return agents.map((agent) => ({
      id: `palette-agent-${agent.name.toLowerCase().replaceAll(" ", "-")}`,
      name: agent.name,
      type: "agent",
      provider: agent.provider,
      category: agent.category,
      permissions: agent.requiredAccess,
      memoryAccess: agent.requiredAccess.includes("Memory") ? agent.requiredAccess : "Workflow-scoped only",
      budgetImpact: "Metadata only",
      approvalMode: agent.defaultMode,
      attachments: agent.name === "Job Discovery Agent" ? ["Search MCP", "Job Search Memory"] : agent.name === "Company Research Agent" ? ["Search MCP", "Research Memory"] : agent.name === "Resume Tailoring Agent" ? ["Docs / Notion MCP", "Resume Memory"] : agent.name === "Outreach Draft Agent" ? ["Gmail Draft MCP", "Job Search Memory"] : []
    }));
  }

  if (tab === "Tools") {
    return mcpTools.map((tool) => ({
      id: `palette-mcp-${tool.name.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`,
      name: tool.name === "Gmail draft-only MCP" ? "Gmail Draft MCP" : tool.name,
      type: "mcp",
      category: "Tool",
      riskLevel: tool.risk,
      permissions: tool.permission,
      memoryAccess: "No memory unless Flow grants context",
      budgetImpact: "Usage metered by connected agent",
      approvalMode: tool.permission,
      attachments: [tool.scopes]
    }));
  }

  if (tab === "Memory") {
    return memoryPartitions.map((partition) => ({
      id: `palette-memory-${partition.name.toLowerCase().replaceAll(" ", "-")}`,
      name: partition.name,
      type: "memory",
      category: partition.workflow,
      riskLevel: partition.sensitivity,
      permissions: partition.permissionLevel,
      memoryAccess: partition.access,
      budgetImpact: "$0.00",
      approvalMode: partition.permissionLevel,
      attachments: [partition.description]
    }));
  }

  return builderControls.map((control) => ({
    id: `palette-control-${control.name.toLowerCase().replaceAll(" ", "-")}`,
    name: control.name,
    type: "control",
    category: "Control",
    riskLevel: control.riskLevel,
    permissions: control.permissions,
    memoryAccess: control.memoryAccess,
    budgetImpact: control.budgetImpact,
    approvalMode: control.approvalMode,
    attachments: [control.permissions]
  }));
}
