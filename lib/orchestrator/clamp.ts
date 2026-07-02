import { EXTERNAL_PERMISSION } from "../registry/normalize";
import type { McpDefaultPermission } from "../types";
import { permissionRank, type PlannedFlow, type PlannedFlowTool } from "./schema";
import type { ResolvedFlow, ResolvedTool } from "./resolve";

// Returns the strictest (least permissive) of the given permissions.
function strictest(...permissions: McpDefaultPermission[]): McpDefaultPermission {
  return permissions.reduce((a, b) => (permissionRank(b) > permissionRank(a) ? b : a));
}

// The "ceiling" is the most permissive value the user is allowed to pick (a floor
// on strictness). It mirrors lib/registry/normalize.ts:
//   - never more permissive than the server's recommendedPermission
//   - any non-verified server: at least approval_required (EXTERNAL_PERMISSION)
//   - restricted risk: always blocked
function ceilingFor(tool: ResolvedTool): { ceiling: McpDefaultPermission; reason: string | null } {
  let ceiling = tool.recommendedPermission;
  let reason: string | null = null;

  if (tool.verificationStatus !== "verified") {
    const next = strictest(ceiling, EXTERNAL_PERMISSION);
    if (permissionRank(next) > permissionRank(ceiling)) reason = "unverified server requires at least approval";
    ceiling = next;
  }

  if (tool.riskLevel === "restricted") {
    if (permissionRank("blocked") > permissionRank(ceiling)) reason = "restricted server is blocked";
    ceiling = "blocked";
  }

  return { ceiling, reason };
}

// Clamps every tool's requested permission. The model never sets permissions: the
// effective value is the stricter of (requested, ceiling). The clamped value is
// what the UI shows and the save path persists. Each value the clamp changed adds
// a warning "<server>: <requested> → <effective> (reason)".
export function clampPermissions(flow: ResolvedFlow): { plan: PlannedFlow; warnings: string[] } {
  const warnings: string[] = [];

  const tools: PlannedFlowTool[] = flow.tools.map((tool) => {
    const { ceiling, reason } = ceilingFor(tool);
    const effective = strictest(tool.requestedPermission, ceiling);

    if (effective !== tool.requestedPermission) {
      const why = reason ?? "exceeds recommended permission for this server";
      warnings.push(`${tool.displayName}: ${tool.requestedPermission} → ${effective} (${why})`);
    }

    return {
      key: tool.key,
      serverName: tool.serverName,
      displayName: tool.displayName,
      mcpServerId: tool.mcpServerId,
      requestedPermission: tool.requestedPermission,
      effectivePermission: effective,
      ceiling,
      riskLevel: tool.riskLevel,
      verificationStatus: tool.verificationStatus,
      rationale: tool.rationale
    };
  });

  return {
    plan: {
      name: flow.name,
      goal: flow.goal,
      agents: flow.agents,
      tools,
      memoryAttachments: flow.memoryAttachments,
      approvalGates: flow.approvalGates,
      estimatedBudgetCents: flow.estimatedBudgetCents,
      risks: flow.risks
    },
    warnings
  };
}
