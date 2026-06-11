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

export const flowPlanAgentSchema = z.object({
  agentName: z.string().min(1), // resolved against the catalog later (resolve.ts)
  role: z.string().min(3).max(120),
  order: z.number().int().min(1),
  rationale: z.string().min(3).max(300)
});

export const flowPlanToolSchema = z.object({
  serverName: z.string().min(1), // resolved against the catalog snapshot later
  requestedPermission: z.enum(PERMISSION_VALUES),
  rationale: z.string().min(3).max(300)
});

export const flowPlanMemorySchema = z.object({
  partitionName: z.string().min(1),
  access: z.enum(["read", "read_write"]),
  rationale: z.string().min(3).max(300)
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
// Carries internal ids for resolution, but prompt.ts serializes only name +
// one-line description (ids and policy ceilings never leak into the prompt).

export type CatalogSnapshotAgent = {
  name: string;
  category: string;
  description: string;
};

export type CatalogSnapshotTool = {
  id: string; // mcpServer.id — used by convert.ts to attach by id; never prompted
  serverName: string; // display name; the verbatim key the model must reuse
  displayName: string;
  description: string;
  riskLevel: McpRiskLevel;
  verificationStatus: McpVerificationStatus;
  recommendedPermission: McpDefaultPermission;
  toolNames: string[]; // curated tool names; empty for external servers
};

export type CatalogSnapshotMemory = {
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

export type PlannedFlowTool = {
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
  agents: FlowPlanAgent[];
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

export type PlannedFlowResponse = {
  plan: PlannedFlow;
  warnings: string[];
  planMeta: PlanMeta;
};
