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
  PersistedWorkflowRun,
  RunEventMeta
} from "../types";
import type {
  ApprovalResolveInput,
  CreateFlowAgentInput,
  CreateFlowInput,
  MemoryGrantPatchInput,
  ToolAttachInput as ToolAttachRequestInput,
  ToolGrantPatchInput
} from "../validation/schemas";
import type { PlannedFlowResponse } from "../orchestrator/schema";

// TODO: response keys still mirror the DB (workflow/mcp). The domain verbs here
// already say Flow/Tool; once the Prisma models are renamed (@@map), drop the
// internal workflow/mcp wording from the Persisted* types too.
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

// Request shapes are single-sourced from the Zod schemas the routes validate with.
export type SaveFlowAgentInput = CreateFlowAgentInput;
export type SaveFlowInput = CreateFlowInput;

export function bootstrap(fallbackMessage = "Unable to bootstrap workspace.") {
  return request<{ bootstrapped: boolean; createdWorkflow: boolean; createdPartitions: string[] }>(
    "/api/bootstrap",
    fallbackMessage,
    { method: "POST" }
  );
}

// Calls the orchestrator. The server returns the clamped plan, warnings, and real
// token/cost meta — the throw carries the route's message (503/429/422/502 etc.).
export function planFlow(goal: string, fallbackMessage = "Unable to plan this Flow.") {
  return request<PlannedFlowResponse>("/api/flows/plan", fallbackMessage, jsonInit("POST", { goal }));
}

export function listFlows(fallbackMessage = "Unable to load saved Flows.") {
  return request<{ workflows: PersistedWorkflow[]; bootstrapped?: boolean }>("/api/workflows", fallbackMessage);
}

export function saveFlow(payload: SaveFlowInput, fallbackMessage = "Flow save failed.") {
  return request<{
    workflow: PersistedWorkflow;
    skippedAgents: string[];
    skippedTools?: string[];
    skippedMemory?: string[];
    message?: string;
  }>(
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
  status: ApprovalResolveInput["status"],
  editedArgs?: Record<string, string>,
  fallbackMessage = "Unable to resolve approval."
) {
  return request<{ approvalRequest: PersistedApprovalRequest; run?: { runId: string; status: string } | null }>(
    `/api/approvals/${approvalId}/resolve`,
    fallbackMessage,
    jsonInit("POST", { status, editedArgs })
  );
}

// Respond to a non-approval interaction intent (choice/form/confirmation). The
// response is validated server-side against the intent payload.
export function respondToIntent(
  intentId: string,
  response: Record<string, unknown>,
  fallbackMessage = "Unable to submit your response."
) {
  return request<{ approvalRequest: PersistedApprovalRequest; run?: { runId: string; status: string } | null }>(
    `/api/approvals/${intentId}/resolve`,
    fallbackMessage,
    jsonInit("POST", { response })
  );
}

// One pending intent waiting on the human, with enough context to render the
// banner, the attention queue, AND the focused window (no second fetch).
export type PendingIntentSummary = {
  id: string;
  intentType: string | null;
  payload: unknown;
  title: string;
  description: string;
  requestedAt: string;
  runId: string;
  runStatus: string;
  flowId: string | null;
  flowName: string;
  agentName: string | null;
};

// Every intent currently waiting on the user, across all runs — the single
// pending-intents source the attention surface (banner/queue/window) reads.
export function listPendingIntents(fallbackMessage = "Unable to load pending requests.") {
  return request<{ intents: PendingIntentSummary[] }>("/api/approvals", fallbackMessage);
}

export function listActivity(fallbackMessage = "Unable to load Timeline.") {
  return request<{ activityLogs: PersistedActivityLog[] }>("/api/activity", fallbackMessage);
}

export type ListToolServersParams = {
  q?: string;
  category?: string;
  riskLevel?: "low" | "medium" | "high" | "restricted";
  verification?: "verified" | "community" | "unverified";
  source?: string;
  cursor?: string;
  limit?: number;
};

export function listToolServers(
  params: ListToolServersParams | string = {},
  fallbackMessage = "Unable to load MCP catalog."
) {
  if (typeof params === "string") {
    return request<{ servers: PersistedMcpServer[]; nextCursor?: string | null; total?: number }>(
      "/api/mcp/servers",
      params
    );
  }
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.category) qs.set("category", params.category);
  if (params.riskLevel) qs.set("riskLevel", params.riskLevel);
  if (params.verification) qs.set("verification", params.verification);
  if (params.source) qs.set("source", params.source);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const path = qs.toString() ? `/api/mcp/servers?${qs.toString()}` : "/api/mcp/servers";
  return request<{ servers: PersistedMcpServer[]; nextCursor?: string | null; total?: number }>(
    path,
    fallbackMessage
  );
}

export type SyncSummary = {
  fetched: number;
  upserted: number;
  skipped: number;
  failed: number;
  source: string;
  durationMs: number;
};

export function syncToolCatalog(fallbackMessage = "Tool sync failed.") {
  return request<SyncSummary>("/api/mcp/sync-registry", fallbackMessage, { method: "POST" });
}

export type AttachToolInput = ToolAttachRequestInput;

export function attachToolToFlow(workflowId: string, payload: AttachToolInput, fallbackMessage = "Unable to add tool to Flow.") {
  return request<{ workflowMcp: PersistedWorkflowMcp; accessGrant: PersistedMcpAccessGrant }>(
    `/api/workflows/${workflowId}/mcps`,
    fallbackMessage,
    jsonInit("POST", payload)
  );
}

export function patchToolGrant(
  grantId: string,
  payload: ToolGrantPatchInput,
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
  payload: MemoryGrantPatchInput,
  fallbackMessage = "Unable to update memory grant."
) {
  return request<{ grant: PersistedMemoryGrant }>(`/api/memory/grants/${grantId}`, fallbackMessage, jsonInit("PATCH", payload));
}

export function revokeMemoryGrant(grantId: string, fallbackMessage = "Unable to revoke memory grant.") {
  return request<{ grant: PersistedMemoryGrant }>(`/api/memory/grants/${grantId}/revoke`, fallbackMessage, { method: "POST" });
}

// --- Chunk 4: BYO provider credentials (metadata only ever crosses the wire) ---
export type CredentialMetadata = { id: string; provider: string; last4: string | null; status: string; createdAt: string };

export function listCredentials(fallbackMessage = "Unable to load provider keys.") {
  return request<{ credentials: CredentialMetadata[] }>("/api/credentials", fallbackMessage);
}

export function addCredential(provider: "anthropic" | "openai" | "openrouter", key: string, fallbackMessage = "Unable to store provider key.") {
  return request<{ credential: CredentialMetadata }>("/api/credentials", fallbackMessage, jsonInit("POST", { provider, key }));
}

export function revokeCredential(id: string, fallbackMessage = "Unable to revoke provider key.") {
  return request<{ ok: boolean }>(`/api/credentials/${id}/revoke`, fallbackMessage, { method: "POST" });
}

// --- Chunk 4: real governed runs ---
export type RealRunEvent = {
  id: string; eventType: string; title: string; description: string; decision: string | null;
  costCents: number; actorType: string | null; resourceType: string | null; authorityRef: string | null;
  untrusted: boolean; createdAt: string; metadata: RunEventMeta;
  agentId?: string | null; agentName?: string | null;
};
export type RealRun = {
  id: string; status: string; totalCostCents: number; stepCount: number; toolCallCount: number;
  resultText?: string | null; createdAt?: string; endedAt?: string | null; workflowName?: string;
  events: RealRunEvent[]; approvalRequests: PersistedApprovalRequest[];
};

export type RealRunSummary = {
  id: string; status: string; totalCostCents: number; stepCount: number; toolCallCount: number;
  resultText?: string | null; resultPreview?: string | null; workflowName?: string;
  createdAt: string; endedAt?: string | null;
};

export function startRealRun(workflowId: string, fallbackMessage = "Unable to start run.") {
  return request<{ run: { runId: string; status: string } }>("/api/runs", fallbackMessage, jsonInit("POST", { workflowId }));
}

export function getRealRun(id: string, fallbackMessage = "Unable to load run.") {
  return request<{ run: RealRun }>(`/api/runs/${id}`, fallbackMessage);
}

export function listRealRuns(fallbackMessage = "Unable to load real runs.") {
  return request<{ runs: RealRunSummary[] }>("/api/runs", fallbackMessage);
}

export function killRealRun(id: string, fallbackMessage = "Unable to kill run.") {
  return request<{ ok: boolean }>(`/api/runs/${id}/kill`, fallbackMessage, { method: "POST" });
}

// --- Chunk 12: connect, disconnect, discover, grant MCP servers ---

export type PersistedConnection = {
  id: string; userId: string; serverKey: string; label?: string | null;
  transportConfig?: Record<string, unknown> | null; authProvider?: string | null;
  status: string; lastDiscoveredAt?: string | null; lastError?: string | null;
  createdAt: string; updatedAt: string;
};

export type DiscoveredTool = {
  serverRowId: string; serverKey: string; toolName: string; displayName: string;
  description?: string | null; inputSchema?: Record<string, unknown> | null;
  isExternalSend: boolean; riskLevel: string;
};

export type ConnectableServer = { serverKey: string; displayName: string; transport: string; credentialProvider: string | null };

export function listConnectableServers(fallbackMessage = "Unable to load connectable servers.") {
  return request<{ servers: ConnectableServer[] }>("/api/mcp/registrations", fallbackMessage);
}

export function listConnections(fallbackMessage = "Unable to load connections.") {
  return request<{ connections: PersistedConnection[] }>("/api/mcp/connections", fallbackMessage);
}

export function connectServer(serverKey: string, fallbackMessage = "Unable to connect to server.") {
  return request<{ connection: PersistedConnection; message?: string }>(
    "/api/mcp/connections", fallbackMessage, jsonInit("POST", { serverKey })
  );
}

export function disconnectServer(id: string, fallbackMessage = "Unable to disconnect.") {
  return request<{ ok: boolean }>(`/api/mcp/connections/${id}`, fallbackMessage, { method: "DELETE" });
}

export function discoverTools(connectionId: string, fallbackMessage = "Tool discovery failed.") {
  return request<{ connection: PersistedConnection; tools: { toolName: string; serverRowId: string; isNew: boolean }[]; reconciled: { removed: string[] } }>(
    `/api/mcp/connections/${connectionId}/discover`, fallbackMessage, { method: "POST" }
  );
}

export function listDiscoveredTools(connectionId: string, fallbackMessage = "Unable to list discovered tools.") {
  return request<{ tools: DiscoveredTool[] }>(`/api/mcp/connections/${connectionId}/tools`, fallbackMessage);
}

export function removeToolGrant(workflowId: string, mcpId: string, fallbackMessage = "Unable to remove tool grant.") {
  return request<{ ok: boolean }>(`/api/workflows/${workflowId}/mcps/${mcpId}`, fallbackMessage, { method: "DELETE" });
}
