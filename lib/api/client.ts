// Typed fetch wrappers for every API endpoint. Each returns parsed data and
// throws Error(message) on non-ok responses; callers pass the same fallback
// message they previously used inline so user-visible errors are unchanged.
import type {
  PersistedActivityLog,
  PersistedApprovalRequest,
  PersistedMcpAccessGrant,
  PersistedMcpServer,
  PersistedMemoryGrant,
  PersistedMemoryPayload,
  PersistedWorkflow,
  PersistedWorkflowMcp,
  PersistedWorkflowRun
} from "../types";

async function request<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? fallbackMessage);
  }

  return data as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

export type SaveFlowAgentInput = {
  agentId?: string;
  agentName?: string;
  name?: string;
  roleInWorkflow: string;
  routeOrder: number;
  defaultMode: string;
};

export type SaveFlowInput = {
  name: string;
  goal: string;
  weeklyBudgetCents: number;
  maxRunBudgetCents: number;
  approvalMode: string;
  agents?: SaveFlowAgentInput[];
};

export function listFlows(fallbackMessage = "Unable to load saved Flows.") {
  return request<{ workflows: PersistedWorkflow[]; bootstrapped?: boolean }>("/api/workflows", fallbackMessage);
}

export function saveFlow(payload: SaveFlowInput, fallbackMessage = "Flow save failed.") {
  return request<{ workflow: PersistedWorkflow; skippedAgents: string[] }>(
    "/api/workflows",
    fallbackMessage,
    jsonInit("POST", payload)
  );
}

export function listRuns(fallbackMessage = "Unable to load runs.") {
  return request<{ workflowRuns: PersistedWorkflowRun[] }>("/api/workflow-runs", fallbackMessage);
}

export function simulateRun(workflowId: string, fallbackMessage = "Run preview failed.") {
  return request<{ workflowRun: PersistedWorkflowRun }>(
    "/api/workflow-runs/simulate",
    fallbackMessage,
    jsonInit("POST", { workflowId })
  );
}

export function resolveApproval(
  approvalId: string,
  status: "approved" | "denied" | "edited",
  fallbackMessage = "Unable to resolve approval."
) {
  return request<{ approvalRequest: PersistedApprovalRequest }>(
    `/api/approvals/${approvalId}/resolve`,
    fallbackMessage,
    jsonInit("POST", { status })
  );
}

export function listActivity(fallbackMessage = "Unable to load Timeline.") {
  return request<{ activityLogs: PersistedActivityLog[] }>("/api/activity", fallbackMessage);
}

export function listToolServers(fallbackMessage = "Unable to load MCP catalog.") {
  return request<{ servers: PersistedMcpServer[] }>("/api/mcp/servers", fallbackMessage);
}

export function syncToolCatalog(fallbackMessage = "Tool sync failed.") {
  return request<{ imported: number; source: string }>("/api/mcp/sync-registry", fallbackMessage, { method: "POST" });
}

export type AttachToolInput = {
  mcpServerId: string;
  purpose?: string;
  defaultPermission?: string;
};

export function attachToolToFlow(workflowId: string, payload: AttachToolInput, fallbackMessage = "Unable to add tool to Flow.") {
  return request<{ workflowMcp: PersistedWorkflowMcp; accessGrant: PersistedMcpAccessGrant }>(
    `/api/workflows/${workflowId}/mcps`,
    fallbackMessage,
    jsonInit("POST", payload)
  );
}

export function patchToolGrant(
  grantId: string,
  payload: Partial<Pick<PersistedMcpAccessGrant, "canRead" | "canWrite" | "canExecute" | "canDelete" | "requiresApproval">>,
  fallbackMessage = "Unable to update tool access."
) {
  return request<{ grant: PersistedMcpAccessGrant }>(`/api/mcp/grants/${grantId}`, fallbackMessage, jsonInit("PATCH", payload));
}

export function revokeToolGrant(grantId: string, fallbackMessage = "Unable to revoke tool.") {
  return request<{ grant: PersistedMcpAccessGrant }>(`/api/mcp/grants/${grantId}/revoke`, fallbackMessage, { method: "POST" });
}

export function loadMemory(fallbackMessage = "Unable to load memory policy.") {
  return request<PersistedMemoryPayload>("/api/memory", fallbackMessage);
}

export function patchMemoryGrant(
  grantId: string,
  payload: Partial<Pick<PersistedMemoryGrant, "canRead" | "canWrite" | "canEdit" | "canDelete" | "canShare" | "requiresApproval">>,
  fallbackMessage = "Unable to update memory grant."
) {
  return request<{ grant: PersistedMemoryGrant }>(`/api/memory/grants/${grantId}`, fallbackMessage, jsonInit("PATCH", payload));
}

export function revokeMemoryGrant(grantId: string, fallbackMessage = "Unable to revoke memory grant.") {
  return request<{ grant: PersistedMemoryGrant }>(`/api/memory/grants/${grantId}/revoke`, fallbackMessage, { method: "POST" });
}
