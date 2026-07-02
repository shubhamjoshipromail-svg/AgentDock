import { z } from "zod";

import type { McpDefaultPermission, McpRiskLevel, McpVerificationStatus } from "../types";

// Single source of truth for what a "plan" is — shared by the prompt, validation,
// resolution, clamping, the route response, and the Builder UI. Nothing else may
// define its own plan shape.

export const PERMISSION_VALUES = ["read_only", "draft_only", "approval_required", "blocked"] as const;

// Strictness order, least -> most strict. Shared by clamp (ceiling math) and the
// UI (which restricts the permission select to values no looser than the ceiling).
export const PERMISSION_STRICTNESS: readonly McpDefaultPermission[] = PERMISSION_VALUES;

export function permissionRank(permission: McpDefaultPermission): number {
  return PERMISSION_STRICTNESS.indexOf(permission);
}

// ---- The raw plan the model must return (validated verbatim) ----

// IDENTITY RULE (Chunk 19): nothing authoritative binds by display string.
// Tools are referenced by the Chunk-16 canonical execution identity
// (`mcpServerKey:mcpToolName`, e.g. "search:web_search"); agents/memory by their
// stable catalog ids ("participant identity" — the same field later binds
// external participants by their protocol-native id). Names may accompany for
// readability; the key/id is authoritative. Name-only stays accepted as a
// fallback (normalized + alias matching in resolve.ts), never as the contract.

export const flowPlanAgentSchema = z
  .object({
    agentId: z.string().min(1).optional(), // stable catalog id — authoritative
    agentName: z.string().min(1).optional(), // readability / legacy fallback
    role: z.string().min(3).max(120),
    order: z.number().int().min(1),
    rationale: z.string().min(3).max(300)
  })
  .refine((agent) => Boolean(agent.agentId || agent.agentName), {
    message: "agentId (preferred) or agentName is required"
  });

export const flowPlanToolSchema = z
  .object({
    key: z.string().min(1).optional(), // canonical `serverKey:toolName` — authoritative
    serverName: z.string().min(1).optional(), // readability / legacy fallback
    requestedPermission: z.enum(PERMISSION_VALUES),
    rationale: z.string().min(3).max(300)
  })
  .refine((tool) => Boolean(tool.key || tool.serverName), {
    message: "key (preferred) or serverName is required"
  });

export const flowPlanMemorySchema = z
  .object({
    partitionId: z.string().min(1).optional(), // stable catalog id — authoritative
    partitionName: z.string().min(1).optional(),
    access: z.enum(["read", "read_write"]),
    rationale: z.string().min(3).max(300)
  })
  .refine((memory) => Boolean(memory.partitionId || memory.partitionName), {
    message: "partitionId (preferred) or partitionName is required"
  });

export const flowPlanApprovalGateSchema = z.object({
  afterAgentOrder: z.number().int(),
  trigger: z.string().min(3).max(200),
  actionType: z.string().min(3).max(80)
});

export const flowPlanRiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  description: z.string().min(3).max(300)
});

export const flowPlanSchema = z.object({
  name: z.string().min(3).max(80),
  goal: z.string().min(3).max(500),
  agents: z.array(flowPlanAgentSchema).min(1).max(8),
  // Optional collections default to [] so a model that omits an empty section
  // still validates (fewer retries, lower cost).
  tools: z.array(flowPlanToolSchema).max(6).default([]),
  memoryAttachments: z.array(flowPlanMemorySchema).max(8).default([]),
  approvalGates: z.array(flowPlanApprovalGateSchema).max(4).default([]),
  estimatedBudgetCents: z.number().int().min(0).max(100000),
  risks: z.array(flowPlanRiskSchema).max(6).default([])
});

export type FlowPlan = z.infer<typeof flowPlanSchema>;
export type FlowPlanAgent = z.infer<typeof flowPlanAgentSchema>;
export type FlowPlanTool = z.infer<typeof flowPlanToolSchema>;
export type FlowPlanMemory = z.infer<typeof flowPlanMemorySchema>;
export type FlowPlanApprovalGate = z.infer<typeof flowPlanApprovalGateSchema>;
export type FlowPlanRisk = z.infer<typeof flowPlanRiskSchema>;

// ---- The catalog snapshot sent to the model ----
// Serves each entry with its AUTHORITATIVE identity: tools carry the Chunk-16
// canonical execution key (`serverKey:toolName`); agents/memory their stable
// catalog ids. prompt.ts enumerates `key/id — name — description`; the DB UUID
// for tools stays internal FK plumbing (never prompted).

export type CatalogSnapshotAgent = {
  id: string; // stable catalog id — the authoritative planning reference
  name: string;
  category: string;
  description: string;
};

export type CatalogSnapshotTool = {
  id: string; // mcpServer.id — internal FK for the save path; never prompted
  key: string | null; // canonical `mcpServerKey:mcpToolName`; null = metadata-only row (not attachable)
  serverName: string; // display name (readability; never authoritative)
  displayName: string;
  description: string;
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
  recommendedPermission: McpDefaultPermission;
  toolNames: string[]; // curated tool names; empty for external servers
};

export type CatalogSnapshotMemory = {
  id: string; // stable catalog id — the authoritative planning reference
  partitionName: string;
  domain: string;
  sensitivity: string;
};

export type CatalogSnapshotPolicy = {
  weeklyBudgetCents: number;
  maxRunBudgetCents: number;
  approvalMode: string;
};

export type CatalogSnapshot = {
  agents: CatalogSnapshotAgent[];
  tools: CatalogSnapshotTool[];
  memory: CatalogSnapshotMemory[];
  policy: CatalogSnapshotPolicy;
};

// ---- The clamped, resolved plan + response returned to the client ----

// A resolved agent reference: both the stable catalog id (authoritative) and the
// canonical name (display) are guaranteed after resolution.
export type ResolvedPlanAgent = {
  agentId: string;
  agentName: string;
  role: string;
  order: number;
  rationale: string;
};

export type PlannedFlowTool = {
  key: string; // canonical `serverKey:toolName` — the one identity across plan → grant → execute
  serverName: string;
  displayName: string;
  mcpServerId: string; // resolved id for the save path
  requestedPermission: McpDefaultPermission;
  effectivePermission: McpDefaultPermission; // after server-side clamping
  ceiling: McpDefaultPermission; // strictest value the user may loosen to in the UI
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
  rationale: string;
};

export type PlannedFlow = {
  name: string;
  goal: string;
  agents: ResolvedPlanAgent[];
  tools: PlannedFlowTool[];
  memoryAttachments: FlowPlanMemory[];
  approvalGates: FlowPlanApprovalGate[];
  estimatedBudgetCents: number;
  risks: FlowPlanRisk[];
};

export type PlanMeta = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
};

// The resolution report — first-class, rendered by the UI BEFORE the user saves:
// what was attached, what was clamped/adjusted, and what FAILED to resolve
// (prominently, never a footnote). No path exists from "model asked for X" to
// "X quietly absent."
export type ResolutionReportEntry = {
  kind: "agent" | "tool" | "memory";
  asked: string;
  reason: string;
  closestMatches: string[];
};

export type ResolutionReport = {
  attached: { kind: "agent" | "tool" | "memory"; id: string; name: string }[];
  clamped: string[]; // permission clamps + other visible adjustments
  failed: ResolutionReportEntry[];
  replanned: boolean; // one automatic feedback re-plan was attempted
};

export type PlannedFlowResponse = {
  plan: PlannedFlow;
  warnings: string[];
  report: ResolutionReport;
  planMeta: PlanMeta;
};
