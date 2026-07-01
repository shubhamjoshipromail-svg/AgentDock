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

export const planFlowSchema = z.object({
  goal: z.string().min(3).max(500)
});

export const simulateRunSchema = z.object({
  workflowId: z.string().uuid({ message: "workflowId must be a UUID of a saved workflow." })
});

export const approvalResolveSchema = z.object({
  // Approval intents carry a status; choice/form/confirmation intents carry a
  // response instead (validated server-side against the intent payload).
  status: z.enum(["approved", "denied", "edited"]).optional(),
  editedArgs: z.record(z.string(), z.string()).optional(),
  response: z.record(z.string(), z.unknown()).optional()
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
  verification: z.enum(["verified", "community", "unverified"]).optional(),
  source: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export type CreateFlowInput = z.infer<typeof createFlowSchema>;
export type CreateFlowAgentInput = z.infer<typeof createFlowAgentSchema>;
export type CreateFlowToolInput = z.infer<typeof createFlowToolSchema>;
export type CreateFlowMemoryInput = z.infer<typeof createFlowMemorySchema>;
export type PlanFlowInput = z.infer<typeof planFlowSchema>;
export type SimulateRunInput = z.infer<typeof simulateRunSchema>;
export type ApprovalResolveInput = z.infer<typeof approvalResolveSchema>;
export type ToolGrantPatchInput = z.infer<typeof toolGrantPatchSchema>;
export type MemoryGrantPatchInput = z.infer<typeof memoryGrantPatchSchema>;
export type ToolAttachInput = z.infer<typeof toolAttachSchema>;

// Chunk 4: BYO provider key intake. The key is write-only — accepted, encrypted,
// never returned. Bounds keep an accidental paste of a huge blob out.
export const createCredentialSchema = z.object({
  provider: z.enum(["anthropic", "openai", "openrouter"]),
  key: z.string().min(20).max(400)
});

// Chunk 4: start a real run for a saved flow.
export const startRunSchema = z.object({
  workflowId: z.string().uuid()
});

// Chunk 12: connect to a registered MCP server.
export const connectServerSchema = z.object({
  serverKey: z.string().min(1).max(100)
});

// Chunk 12: grant a discovered tool into a flow.
export const grantToolSchema = z.object({
  mcpServerId: z.string().uuid({ message: "mcpServerId must be the UUID of a discovered tool row." }),
  permission: z.enum(["read_only", "draft_only", "approval_required", "blocked"]).optional()
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
export type ConnectServerInput = z.infer<typeof connectServerSchema>;
export type GrantToolInput = z.infer<typeof grantToolSchema>;
