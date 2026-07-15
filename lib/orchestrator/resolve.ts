import type { McpDefaultPermission, McpRiskLevel, McpVerificationStatus } from "../types";
import type {
  CatalogSnapshot,
  CatalogSnapshotTool,
  FlowPlan,
  FlowPlanApprovalGate,
  FlowPlanMemory,
  ResolvedPlanAgent
} from "./schema";

// A tool matched to a catalog entry but not yet clamped. clamp.ts turns this into
// a PlannedFlowTool by computing the ceiling + effective permission.
export type ResolvedTool = {
  key: string; // canonical `serverKey:toolName` — the Chunk-16 execution identity
  serverName: string;
  displayName: string;
  mcpServerId: string;
  agentOrder: number;
  requestedPermission: McpDefaultPermission;
  recommendedPermission: McpDefaultPermission;
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
  isExternalSend: boolean; // Chunk-16 classification — drives capability tags
  rationale: string;
};

export type ResolvedFlow = {
  name: string;
  goal: string;
  agents: ResolvedPlanAgent[];
  tools: ResolvedTool[];
  memoryAttachments: FlowPlanMemory[];
  approvalGates: FlowPlanApprovalGate[];
  estimatedBudgetCents: number;
  risks: FlowPlan["risks"];
};

// A first-class resolution failure: something the plan asked for that did not
// resolve. NEVER a quiet omission — the route feeds these back to the model for
// one automatic re-plan, then surfaces the remainder loudly to the user.
export type ResolutionFailure = {
  kind: "agent" | "tool" | "memory";
  asked: string; // what the model asked for (key/id/name as emitted)
  reason: string;
  closestMatches: string[]; // canonical keys/names the model likely meant
};

// IDENTITY DISCIPLINE: resolution binds by canonical key/id FIRST (the value the
// model was told to emit). Name matching survives only as a fallback and is
// normalized (case/punctuation-insensitive) over an alias set derived from the
// row's own identities (canonical key, its parts, display name) — so renaming a
// displayName can never break planning (the Chunk-16-rename scenario). Anything
// that still misses is recorded; Chunk 19 Phase 2 turns misses into loud
// resolution failures with a re-plan loop — never a quiet omission.

// Normalize for fallback matching: lowercase, strip everything non-alphanumeric.
export function normalizeRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// All the normalized aliases a snapshot tool answers to. Derived from the row's
// identities — no hand-maintained alias list to rot.
function toolAliases(tool: CatalogSnapshotTool): string[] {
  const aliases = new Set<string>();
  aliases.add(normalizeRef(tool.serverName));
  aliases.add(normalizeRef(tool.displayName));
  if (tool.key) {
    aliases.add(normalizeRef(tool.key)); // "search:web_search" → "searchwebsearch"
    const [serverKey, toolName] = tool.key.split(":");
    if (serverKey) aliases.add(normalizeRef(serverKey));
    if (toolName) aliases.add(normalizeRef(toolName)); // "web_search" → "websearch"
  }
  for (const name of tool.toolNames) aliases.add(normalizeRef(name));
  aliases.delete("");
  return Array.from(aliases);
}

function findTool(snapshot: CatalogSnapshot, ref: { key?: string; serverName?: string }): CatalogSnapshotTool | undefined {
  // 1. Canonical key — authoritative, exact.
  if (ref.key) {
    const byKey = snapshot.tools.find((tool) => tool.key === ref.key);
    if (byKey) return byKey;
  }
  // 2. Fallback: normalized alias matching over whatever the model emitted.
  const wanted = [ref.key, ref.serverName].filter((v): v is string => Boolean(v)).map(normalizeRef);
  return snapshot.tools.find((tool) => {
    const aliases = toolAliases(tool);
    return wanted.some((w) => aliases.includes(w));
  });
}

function findAgent(snapshot: CatalogSnapshot, ref: { agentId?: string; agentName?: string }) {
  if (ref.agentId) {
    const byId = snapshot.agents.find((agent) => agent.id === ref.agentId);
    if (byId) return byId;
  }
  if (ref.agentName) {
    const wanted = normalizeRef(ref.agentName);
    return snapshot.agents.find((agent) => normalizeRef(agent.name) === wanted);
  }
  return undefined;
}

function findPartition(snapshot: CatalogSnapshot, ref: { partitionId?: string; partitionName?: string }) {
  if (ref.partitionId) {
    const byId = snapshot.memory.find((partition) => partition.id === ref.partitionId);
    if (byId) return byId;
  }
  if (ref.partitionName) {
    const wanted = normalizeRef(ref.partitionName);
    return snapshot.memory.find((partition) => normalizeRef(partition.partitionName) === wanted);
  }
  return undefined;
}

// Rank catalog candidates by normalized-token similarity to what was asked —
// cheap, dependency-free "did you mean" for the failure report.
function closestMatches(asked: string, candidates: string[], limit = 3): string[] {
  const wanted = normalizeRef(asked);
  if (!wanted) return candidates.slice(0, limit);
  return candidates
    .map((candidate) => {
      const c = normalizeRef(candidate);
      let score = 0;
      if (c.includes(wanted) || wanted.includes(c)) score += 2;
      // Shared 3-gram overlap as a crude similarity signal.
      for (let i = 0; i + 3 <= wanted.length; i++) if (c.includes(wanted.slice(i, i + 3))) score += 1;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

// Resolves every plan reference against the catalog snapshot by canonical
// identity (with normalized-name fallback), re-normalizes agent order to a
// contiguous 1..n, and re-points approval gates. Misses are FIRST-CLASS
// FAILURES (never quiet omissions); degradations (gate re-points) stay
// warnings. Never auto-creates anything — plan-time references must exist.
export function resolvePlan(
  plan: FlowPlan,
  snapshot: CatalogSnapshot
): { plan: ResolvedFlow; warnings: string[]; failures: ResolutionFailure[] } {
  const warnings: string[] = [];
  const failures: ResolutionFailure[] = [];

  // --- Agents: resolve by id (fallback normalized name), then re-normalize order ---
  const matchedAgents = plan.agents
    .map((agent) => ({ agent, match: findAgent(snapshot, agent) }))
    .filter((entry) => {
      if (!entry.match) {
        const asked = entry.agent.agentName ?? entry.agent.agentId ?? "(unnamed)";
        failures.push({
          kind: "agent",
          asked,
          reason: "not in your agent catalog",
          closestMatches: closestMatches(asked, snapshot.agents.map((a) => a.name))
        });
        return false;
      }
      return true;
    })
    .map((entry) => ({ original: entry.agent, match: entry.match!, originalOrder: entry.agent.order }));

  // Sort by the model's order, then assign contiguous 1..n preserving relative order.
  const sorted = [...matchedAgents].sort((a, b) => a.originalOrder - b.originalOrder);
  const remap = sorted.map((entry, index) => ({ ...entry, newOrder: index + 1 }));

  const agents: ResolvedPlanAgent[] = remap.map((entry) => ({
    agentId: entry.match.id,
    agentName: entry.match.name,
    role: entry.original.role,
    order: entry.newOrder,
    rationale: entry.original.rationale
  }));

  // --- Tools: resolve by canonical key (fallback normalized aliases) ---
  // Suggestions draw from canonical keys AND display names (a hallucinated
  // display-ish name still gets a useful "did you mean" pointing at a real key).
  const attachableKeys = snapshot.tools
    .filter((t) => t.key)
    .flatMap((t) => [t.key as string, `${t.key} (${t.displayName})`]);
  const tools: ResolvedTool[] = [];
  for (const tool of plan.tools) {
    const asked = tool.key ?? tool.serverName ?? "(unnamed)";
    const match = findTool(snapshot, tool);
    if (!match) {
      failures.push({
        kind: "tool",
        asked,
        reason: "not in the available tool catalog",
        closestMatches: closestMatches(asked, attachableKeys)
      });
      continue;
    }
    if (!match.key) {
      // Catalog metadata only (no Chunk-16 executable identity): it cannot be
      // attached or granted, so resolving it would only defer the failure to
      // save time. Refuse it here, honestly.
      failures.push({
        kind: "tool",
        asked,
        reason: `"${match.displayName}" is catalog metadata only — connect & discover it first`,
        closestMatches: closestMatches(asked, attachableKeys)
      });
      continue;
    }
    const explicitOwner = tool.agentOrder === undefined
      ? undefined
      : remap.find((entry) => entry.originalOrder === tool.agentOrder);
    const defaultOwner = match.recommendedPermission === "read_only" && !match.isExternalSend
      ? remap[0]
      : remap[remap.length - 1];
    const owner = explicitOwner ?? defaultOwner;
    if (!owner) {
      failures.push({ kind: "tool", asked, reason: "cannot assign the tool because no resolved agent owns it", closestMatches: [] });
      continue;
    }
    if (tool.agentOrder !== undefined && !explicitOwner) {
      warnings.push(`Re-pointed ${match.displayName} from missing agent order ${tool.agentOrder} to agent ${owner.newOrder} (${owner.match.name}).`);
    }
    tools.push({
      key: match.key,
      serverName: match.serverName,
      displayName: match.displayName,
      mcpServerId: match.id,
      agentOrder: owner.newOrder,
      requestedPermission: tool.requestedPermission,
      recommendedPermission: match.recommendedPermission,
      riskLevel: match.riskLevel,
      verificationStatus: match.verificationStatus,
      isExternalSend: match.isExternalSend,
      rationale: tool.rationale
    });
  }

  // --- Memory: resolve by id (fallback normalized name) ---
  const memoryAttachments: FlowPlanMemory[] = [];
  for (const attachment of plan.memoryAttachments) {
    const asked = attachment.partitionName ?? attachment.partitionId ?? "(unnamed)";
    const match = findPartition(snapshot, attachment);
    if (!match) {
      failures.push({
        kind: "memory",
        asked,
        reason: "not one of your memory partitions",
        closestMatches: closestMatches(asked, snapshot.memory.map((m) => m.partitionName))
      });
      continue;
    }
    memoryAttachments.push({ ...attachment, partitionId: match.id, partitionName: match.partitionName });
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
    warnings,
    failures
  };
}
