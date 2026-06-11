import { z } from "zod";

// One schema per route input. Schemas match the fields the routes actually
// use; unknown keys are stripped rather than rejected.

export const createFlowAgentSchema = z.object({
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  name: z.string().optional(),
  roleInWorkflow: z.string(),
  routeOrder: z.number().int(),
  defaultMode: z.string()
});

export const createFlowToolSchema = z.object({
  mcpServerId: z.string().uuid(),
  purpose: z.string().optional(),
  defaultPermission: z.enum(["read_only", "draft_only", "approval_required", "blocked"]).optional()
});

export const createFlowMemorySchema = z.object({
  partitionName: z.string().min(1)
});

export const createFlowSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  weeklyBudgetCents: z.number().int().positive(),
  maxRunBudgetCents: z.number().int().positive(),
  approvalMode: z.enum(["manual", "approval_gated", "autonomous_with_limits"]),
  agents: z.array(createFlowAgentSchema).optional(),
  tools: z.array(createFlowToolSchema).optional(),
  memory: z.array(createFlowMemorySchema).optional(),
  // Serialized builder canvas (nodes, gates, positions) stored on Workflow.layout.
  layout: z.record(z.string(), z.unknown()).optional()
});

export const simulateRunSchema = z.object({
  workflowId: z.string().uuid({ message: "workflowId must be a UUID of a saved workflow." })
});

export const approvalResolveSchema = z.object({
  status: z.enum(["approved", "denied", "edited"])
});

export const toolGrantPatchSchema = z.object({
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canExecute: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  allowedActions: z.array(z.string()).optional(),
  blockedActions: z.array(z.string()).optional()
});

export const memoryGrantPatchSchema = z.object({
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canEdit: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canShare: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  expiresAt: z.string().nullable().optional()
});

export const toolAttachSchema = z.object({
  mcpServerId: z.string().uuid({ message: "mcpServerId must be a UUID. Sync the MCP registry first." }),
  purpose: z.string().optional(),
  defaultPermission: z.enum(["read_only", "draft_only", "approval_required", "blocked"]).optional()
});

export const toolServersQuerySchema = z.object({
  category: z.string().optional(),
  riskLevel: z.enum(["low", "medium", "high", "restricted"]).optional(),
  verified: z.enum(["true", "false"]).optional()
});

export type CreateFlowInput = z.infer<typeof createFlowSchema>;
export type CreateFlowAgentInput = z.infer<typeof createFlowAgentSchema>;
export type CreateFlowToolInput = z.infer<typeof createFlowToolSchema>;
export type CreateFlowMemoryInput = z.infer<typeof createFlowMemorySchema>;
export type SimulateRunInput = z.infer<typeof simulateRunSchema>;
export type ApprovalResolveInput = z.infer<typeof approvalResolveSchema>;
export type ToolGrantPatchInput = z.infer<typeof toolGrantPatchSchema>;
export type MemoryGrantPatchInput = z.infer<typeof memoryGrantPatchSchema>;
export type ToolAttachInput = z.infer<typeof toolAttachSchema>;
