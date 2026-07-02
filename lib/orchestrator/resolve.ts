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
  requestedPermission: McpDefaultPermission;
  recommendedPermission: McpDefaultPermission;
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
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

// Resolves every plan reference against the catalog snapshot by canonical
// identity (with normalized-name fallback), re-normalizes agent order to a
// contiguous 1..n, and re-points approval gates. Misses are recorded as warnings
// (Phase 2 upgrades them to loud resolution failures). Never auto-creates
// anything — plan-time references must already exist.
export function resolvePlan(plan: FlowPlan, snapshot: CatalogSnapshot): { plan: ResolvedFlow; warnings: string[] } {
  const warnings: string[] = [];

  // --- Agents: resolve by id (fallback normalized name), then re-normalize order ---
  const matchedAgents = plan.agents
    .map((agent) => ({ agent, match: findAgent(snapshot, agent) }))
    .filter((entry) => {
      if (!entry.match) {
        warnings.push(`Dropped agent "${entry.agent.agentName ?? entry.agent.agentId}" — not in your agent catalog.`);
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
  const tools: ResolvedTool[] = [];
  for (const tool of plan.tools) {
    const asked = tool.key ?? tool.serverName ?? "(unnamed)";
    const match = findTool(snapshot, tool);
    if (!match) {
      warnings.push(`Dropped tool "${asked}" — not in the available tool catalog.`);
      continue;
    }
    if (!match.key) {
      // Catalog metadata only (no Chunk-16 executable identity): it cannot be
      // attached or granted, so resolving it would only defer the failure to
      // save time. Refuse it here, honestly.
      warnings.push(`Dropped tool "${asked}" — "${match.displayName}" is catalog metadata only (connect & discover it first).`);
      continue;
    }
    tools.push({
      key: match.key,
      serverName: match.serverName,
      displayName: match.displayName,
      mcpServerId: match.id,
      requestedPermission: tool.requestedPermission,
      recommendedPermission: match.recommendedPermission,
      riskLevel: match.riskLevel,
      verificationStatus: match.verificationStatus,
      rationale: tool.rationale
    });
  }

  // --- Memory: resolve by id (fallback normalized name) ---
  const memoryAttachments: FlowPlanMemory[] = [];
  for (const attachment of plan.memoryAttachments) {
    const asked = attachment.partitionName ?? attachment.partitionId ?? "(unnamed)";
    const match = findPartition(snapshot, attachment);
    if (!match) {
      warnings.push(`Dropped memory "${asked}" — not one of your memory partitions.`);
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
    warnings
  };
}
