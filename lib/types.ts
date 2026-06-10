// Single source for all Persisted*/domain types shared by UI and API client.
export type Section = "Build" | "Store" | "Flows" | "Control" | "Profile";
export type StoreTab = "Agents" | "Tools" | "Templates";
export type LibraryTab = "My Flows" | "My Agents" | "My Tools" | "Scoped Access";
export type BuilderPaletteTab = "Agents" | "Tools" | "Memory" | "Controls";
export type BuilderNodeType = "goal" | "agent" | "mcp" | "memory" | "control";
export type BuilderMode = "empty" | "draft" | "saved" | "running" | "approval_pending";
export type RuntimeModeName = "Provider API Mode" | "AgentDock Sandbox Mode" | "User Cloud Mode" | "Local Mode";
export type Decision = "allowed" | "blocked" | "approval_required" | "approved" | "denied" | "info";
export type EventType = "memory access" | "credential minting" | "A2A handoff" | "MCP/tool use" | "approval request" | "blocked action" | "spend event";

export type Agent = {
  name: string;
  category: string;
  provider: string;
  trustScore: number;
  costPerTask: string;
  tokenEfficiency: string;
  requiredAccess: string;
  defaultMode: string;
  verified: boolean;
  description: string;
};

export type AuditEvent = {
  event: string;
  type: EventType;
  agent: string;
  workflow: string;
  tool: string;
  permission: string;
  memory: string;
  cost: string;
  decision: Decision;
};

export type MemoryPartition = {
  name: string;
  sensitivity: "low" | "medium" | "high" | "restricted";
  workflow: string;
  access: string;
  permissionLevel: string;
  allowedAgents: string[];
  blockedAgents: string[];
  permissions: string[];
  description: string;
};

export type PersistedWorkflow = {
  id: string;
  name: string;
  goal: string;
  status: string;
  weeklyBudgetCents: number;
  maxRunBudgetCents: number;
  approvalMode: string;
  workflowAgents: {
    id: string;
    roleInWorkflow: string;
    routeOrder: number;
    defaultMode: string;
    agent: {
      id: string;
      name: string;
      provider: string;
      category: string;
    };
  }[];
  workflowMcps?: PersistedWorkflowMcp[];
  mcpAccessGrants?: PersistedMcpAccessGrant[];
};

export type PersistedWorkflowRunEvent = {
  id: string;
  eventType: string;
  title: string;
  description: string;
  decision: Decision | null;
  mcpTool: string | null;
  costCents: number;
  createdAt: string;
  agent: {
    name: string;
  } | null;
  memoryPartition: {
    name: string;
  } | null;
};

export type PersistedApprovalRequest = {
  id: string;
  title: string;
  description: string;
  actionType: string;
  riskLevel: string;
  status: "pending" | "approved" | "denied" | "edited" | "expired";
  requestedAt: string;
  resolvedAt?: string | null;
  agent: {
    name: string;
  } | null;
};

export type PersistedWorkflowRun = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  totalCostCents: number;
  riskLevel: string;
  workflow: {
    id: string;
    name: string;
  };
  events: PersistedWorkflowRunEvent[];
  approvalRequests: PersistedApprovalRequest[];
};

export type PersistedActivityLog = {
  id: string;
  eventType: string;
  title: string;
  description: string;
  decision: Decision | null;
  costCents: number;
  createdAt: string;
  workflow: {
    name: string;
  } | null;
  workflowRun: {
    id: string;
    status: string;
  } | null;
  agent: {
    name: string;
  } | null;
  metadata?: {
    mcpTool?: string;
    memoryPartitionId?: string;
    workflowName?: string;
    [key: string]: unknown;
  };
};

export type PersistedMemoryItem = {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  sensitivityLevel: "low" | "medium" | "high" | "restricted";
  createdAt: string;
};

export type PersistedMemoryGrant = {
  id: string;
  canRead: boolean;
  canWrite: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  requiresApproval: boolean;
  expiresAt?: string | null;
  agent: {
    id: string;
    name: string;
  } | null;
  workflow: {
    id: string;
    name: string;
  } | null;
  partition?: {
    id: string;
    name: string;
  };
};

export type PersistedMemoryLog = {
  id: string;
  action: string;
  decision: string;
  reason: string;
  createdAt: string;
  agent: {
    name: string;
  } | null;
  workflow: {
    name: string;
  } | null;
};

export type PersistedMemoryPartition = {
  id: string;
  name: string;
  type: string;
  sensitivityLevel: "low" | "medium" | "high" | "restricted";
  description: string;
  defaultAccessPolicy: string;
  workflow: {
    id: string;
    name: string;
  } | null;
  memoryItems: PersistedMemoryItem[];
  accessGrants: PersistedMemoryGrant[];
  accessLogs: PersistedMemoryLog[];
};

export type PersistedMemoryPayload = {
  partitions: PersistedMemoryPartition[];
  grants: PersistedMemoryGrant[];
  logs: PersistedMemoryLog[];
  bootstrapped?: boolean;
};

export type McpRiskLevel = "low" | "medium" | "high" | "restricted";
export type McpDefaultPermission = "read_only" | "draft_only" | "approval_required" | "blocked";

export type PersistedMcpServer = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  registrySource: string;
  registryId?: string | null;
  homepageUrl?: string | null;
  repositoryUrl?: string | null;
  packageName?: string | null;
  packageRegistry?: string | null;
  version?: string | null;
  verified: boolean;
  riskLevel: McpRiskLevel;
  category?: string | null;
  installCommand?: string | null;
  metadata?: {
    recommendedPermission?: McpDefaultPermission;
    [key: string]: unknown;
  };
  tools?: {
    id: string;
    name: string;
    description?: string | null;
    riskLevel: McpRiskLevel;
  }[];
};

export type PersistedWorkflowMcp = {
  id: string;
  purpose?: string | null;
  defaultPermission: McpDefaultPermission;
  mcpServer: PersistedMcpServer;
};

export type PersistedMcpAccessGrant = {
  id: string;
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canDelete: boolean;
  requiresApproval: boolean;
  allowedActions?: string[] | null;
  blockedActions?: string[] | null;
  mcpServer: PersistedMcpServer;
};

export type BuilderNode = {
  id: string;
  name: string;
  type: BuilderNodeType;
  provider?: string;
  category?: string;
  trustScore?: number;
  riskLevel?: string;
  permissions: string;
  memoryAccess: string;
  budgetImpact: string;
  approvalMode: string;
  attachments?: string[];
};

export type ControlComponent = {
  name: string;
  riskLevel: string;
  permissions: string;
  memoryAccess: string;
  budgetImpact: string;
  approvalMode: string;
};

export type RuntimeMode = {
  name: RuntimeModeName;
  description: string;
  bestFor: string;
  status: string;
};

export type CapabilityKind = "db" | "local" | "soon" | "mock";
