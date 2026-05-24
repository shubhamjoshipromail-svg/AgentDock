"use client";

import { useEffect, useMemo, useState } from "react";
import { getProviders, SessionProvider, signIn, signOut, useSession } from "next-auth/react";

type Section = "Build" | "Store" | "Flows" | "Control" | "Profile";
type StoreTab = "Agents" | "Tools" | "Templates";
type LibraryTab = "My Flows" | "My Agents" | "My Tools" | "Scoped Access";
type BuilderPaletteTab = "Agents" | "Tools" | "Memory" | "Controls";
type BuilderNodeType = "goal" | "agent" | "mcp" | "memory" | "control";
type BuilderMode = "empty" | "draft" | "saved" | "running" | "approval_pending";
type RuntimeModeName = "Provider API Mode" | "AgentDock Sandbox Mode" | "User Cloud Mode" | "Local Mode";
type Decision = "allowed" | "blocked" | "approval_required" | "approved" | "denied" | "info";
type EventType = "memory access" | "credential minting" | "A2A handoff" | "MCP/tool use" | "approval request" | "blocked action" | "spend event";

type Agent = {
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

type AuditEvent = {
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

type MemoryPartition = {
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

type PersistedWorkflow = {
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

type PersistedWorkflowRunEvent = {
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

type PersistedApprovalRequest = {
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

type PersistedWorkflowRun = {
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

type PersistedActivityLog = {
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

type PersistedMemoryItem = {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  sensitivityLevel: "low" | "medium" | "high" | "restricted";
  createdAt: string;
};

type PersistedMemoryGrant = {
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

type PersistedMemoryLog = {
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

type PersistedMemoryPartition = {
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

type PersistedMemoryPayload = {
  partitions: PersistedMemoryPartition[];
  grants: PersistedMemoryGrant[];
  logs: PersistedMemoryLog[];
  bootstrapped?: boolean;
};

type McpRiskLevel = "low" | "medium" | "high" | "restricted";
type McpDefaultPermission = "read_only" | "draft_only" | "approval_required" | "blocked";

type PersistedMcpServer = {
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

type PersistedWorkflowMcp = {
  id: string;
  purpose?: string | null;
  defaultPermission: McpDefaultPermission;
  mcpServer: PersistedMcpServer;
};

type PersistedMcpAccessGrant = {
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

type BuilderNode = {
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

type ControlComponent = {
  name: string;
  riskLevel: string;
  permissions: string;
  memoryAccess: string;
  budgetImpact: string;
  approvalMode: string;
};

type RuntimeMode = {
  name: RuntimeModeName;
  description: string;
  bestFor: string;
  status: string;
};

type CapabilityKind = "db" | "local" | "soon" | "mock";

const sections: Section[] = ["Build", "Store", "Flows", "Control", "Profile"];
const flow = ["Discovery", "Research", "Resume", "Outreach"];

const agents: Agent[] = [
  {
    name: "Job Discovery Agent",
    category: "Discovery",
    provider: "OpenAI",
    trustScore: 96,
    costPerTask: "$0.09",
    tokenEfficiency: "91%",
    requiredAccess: "Search + Job Search Memory",
    defaultMode: "Autonomous discovery",
    verified: true,
    description: "Finds matching AI infrastructure roles, ranks fit, and routes targets into the workflow."
  },
  {
    name: "Company Research Agent",
    category: "Research",
    provider: "Claude",
    trustScore: 92,
    costPerTask: "$0.18",
    tokenEfficiency: "84%",
    requiredAccess: "Search + Research Memory",
    defaultMode: "Human-reviewed notes",
    verified: true,
    description: "Builds company briefs with leadership, funding, product, and hiring signals."
  },
  {
    name: "Resume Tailoring Agent",
    category: "Documents",
    provider: "OpenAI",
    trustScore: 89,
    costPerTask: "$0.24",
    tokenEfficiency: "78%",
    requiredAccess: "Resume Memory",
    defaultMode: "Approval before export",
    verified: true,
    description: "Maps role requirements to resume bullets and produces tracked document edits."
  },
  {
    name: "Outreach Draft Agent",
    category: "Communications",
    provider: "Gemini",
    trustScore: 94,
    costPerTask: "$0.11",
    tokenEfficiency: "88%",
    requiredAccess: "Gmail drafts + Research Memory",
    defaultMode: "Never send without approval",
    verified: true,
    description: "Creates recruiter and hiring manager messages for approval-only outreach."
  },
  {
    name: "Shopping Agent",
    category: "Commerce",
    provider: "Open-source",
    trustScore: 81,
    costPerTask: "$0.07",
    tokenEfficiency: "82%",
    requiredAccess: "Commerce memory only",
    defaultMode: "Blocked from job-search memory",
    verified: false,
    description: "Compares products and prices with strict memory isolation."
  },
  {
    name: "Finance Agent",
    category: "Finance",
    provider: "Claude",
    trustScore: 86,
    costPerTask: "$0.16",
    tokenEfficiency: "80%",
    requiredAccess: "Finance Memory",
    defaultMode: "Approval required",
    verified: true,
    description: "Summarizes finance tasks with restricted memory defaults."
  },
  {
    name: "Health Agent",
    category: "Health",
    provider: "OpenAI",
    trustScore: 88,
    costPerTask: "$0.20",
    tokenEfficiency: "76%",
    requiredAccess: "Health Memory",
    defaultMode: "Restricted by default",
    verified: true,
    description: "Handles health notes with restricted memory defaults."
  }
];

const workflowAgents = agents.slice(0, 4);

const mcpTools = [
  { name: "GitHub MCP", scopes: "Read repos, draft PR notes", risk: "Medium", permission: "Approval required for writes", workflows: "Coding Review, Research Briefs", verified: "Verified" },
  { name: "Gmail draft-only MCP", scopes: "Create drafts, never send", risk: "High", permission: "Draft-only by default", workflows: "Job Search, Sales Outreach", verified: "Verified" },
  { name: "Google Calendar MCP", scopes: "Read availability", risk: "Medium", permission: "No scheduling without approval", workflows: "Productivity, Recruiting", verified: "Verified" },
  { name: "Docs / Notion MCP", scopes: "Create notes and drafts", risk: "Medium", permission: "Workspace-scoped", workflows: "Research, Coding Review", verified: "Verified" },
  { name: "Search MCP", scopes: "Public web discovery", risk: "Low", permission: "Allowed within budget", workflows: "All workflows", verified: "Verified" },
  { name: "Stripe MCP later", scopes: "Usage and billing metadata", risk: "High", permission: "Approval always required", workflows: "Billing Ops", verified: "Planned" }
];

const stepDisplayNames: Record<string, string> = {
  "User Goal": "Goal",
  "Job Discovery Agent": "Discovery",
  "Company Research Agent": "Research",
  "Resume Tailoring Agent": "Resume",
  "Outreach Draft Agent": "Outreach",
  "A2UI Approval Gate": "Approval Gate"
};

const workflowTemplates = [
  {
    name: "Job Search Automation",
    agents: "Discovery, Research, Resume, Outreach",
    mcps: "Search, Gmail draft-only, Docs",
    memory: "Job Search, Resume, Research",
    permissions: "Draft-only, apply blocked",
    budget: "$5/week"
  },
  {
    name: "Research Brief Generator",
    agents: "Research, Docs, Reviewer",
    mcps: "Search, Notion / Docs",
    memory: "Research Memory",
    permissions: "Share requires approval",
    budget: "$3/week"
  },
  {
    name: "Coding Review Stack",
    agents: "Code Review, Test Planner, Docs",
    mcps: "GitHub, Docs",
    memory: "Coding Memory",
    permissions: "PR comments require approval",
    budget: "$7/week"
  },
  {
    name: "Sales Outreach Stack",
    agents: "Lead Research, CRM Notes, Outreach Draft",
    mcps: "Search, Gmail draft-only",
    memory: "Team Memory",
    permissions: "Send blocked",
    budget: "$6/week"
  },
  {
    name: "Personal Productivity Stack",
    agents: "Calendar, Notes, Task Router",
    mcps: "Calendar, Docs",
    memory: "Global Profile, Travel",
    permissions: "Schedule approval required",
    budget: "$4/week"
  }
];

const memoryPartitions: MemoryPartition[] = [
  {
    name: "Global Profile",
    sensitivity: "medium",
    workflow: "All workflows",
    access: "User profile only",
    permissionLevel: "Approval required",
    allowedAgents: ["Setup Agent"],
    blockedAgents: ["Shopping", "Finance", "Health"],
    permissions: ["Setup Agent: read with approval", "All other agents: blocked by default"],
    description: "Durable preferences and profile facts that require explicit approval before reuse."
  },
  {
    name: "Job Search Memory",
    sensitivity: "medium",
    workflow: "Job Search Automation",
    access: "Job workflow agents",
    permissionLevel: "Read/write scoped",
    allowedAgents: ["Job Discovery", "Resume Tailoring", "Company Research", "Outreach Draft"],
    blockedAgents: ["Shopping", "Finance", "Health"],
    permissions: ["Job Discovery: read/write", "Resume Tailoring: read/write", "Company Research: read/write", "Outreach Draft: read only + write outreach history", "All other agents: blocked"],
    description: "Search criteria, target companies, role preferences, and approved job-search context."
  },
  {
    name: "Resume Memory",
    sensitivity: "high",
    workflow: "Job Search Automation",
    access: "Resume Tailoring Agent",
    permissionLevel: "Approval required",
    allowedAgents: ["Resume Tailoring"],
    blockedAgents: ["Shopping", "Finance", "Health"],
    permissions: ["Resume Tailoring: read/write with approval", "Outreach Draft: blocked", "All other agents: blocked"],
    description: "Resume source material, approved bullets, work history, and role-specific drafts."
  },
  {
    name: "Research Memory",
    sensitivity: "medium",
    workflow: "Job Search Automation",
    access: "Research + Outreach",
    permissionLevel: "Read/write scoped",
    allowedAgents: ["Company Research", "Outreach Draft"],
    blockedAgents: ["Shopping", "Finance", "Health"],
    permissions: ["Company Research: read/write", "Outreach Draft: read", "All unrelated agents: blocked"],
    description: "Company briefs, hiring signals, recruiter notes, and approved research summaries."
  },
  {
    name: "Finance Memory",
    sensitivity: "restricted",
    workflow: "None",
    access: "Blocked by default",
    permissionLevel: "Blocked",
    allowedAgents: [],
    blockedAgents: ["All agents"],
    permissions: ["Finance Agent: approval required", "All other agents: blocked"],
    description: "Financial preferences and sensitive context, unavailable to job-search agents."
  },
  {
    name: "Health Memory",
    sensitivity: "restricted",
    workflow: "None",
    access: "Blocked by default",
    permissionLevel: "Blocked",
    allowedAgents: [],
    blockedAgents: ["All agents"],
    permissions: ["Health Agent: approval required", "Shopping Agent: blocked", "All other agents: blocked"],
    description: "Health-related context that cannot be read by unrelated agents."
  },
  {
    name: "Travel Memory",
    sensitivity: "high",
    workflow: "None",
    access: "Approval gated",
    permissionLevel: "Approval required",
    allowedAgents: ["Travel Agent"],
    blockedAgents: ["Shopping", "Finance", "Health"],
    permissions: ["Travel Agent: approval required", "All other agents: blocked"],
    description: "Location and itinerary memory, revocable and isolated from other workflows."
  }
];

const baseAuditEvents: AuditEvent[] = [
  { event: "Resume Tailoring Agent read Job Search Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Job Search Memory", cost: "$0.02", decision: "allowed" },
  { event: "Outreach Draft Agent wrote to Outreach History", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail draft-only MCP", permission: "write draft", memory: "Research Memory", cost: "$0.03", decision: "allowed" },
  { event: "Shopping Agent was blocked from Health Memory", type: "blocked action", agent: "Shopping Agent", workflow: "None", tool: "Memory Firewall", permission: "read", memory: "Health Memory", cost: "$0.00", decision: "blocked" },
  { event: "Research Agent requested access to Company Preferences", type: "approval request", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "request_access", memory: "Global Profile", cost: "$0.00", decision: "approval_required" },
  { event: "Scoped access minted for Outreach Draft Agent", type: "credential minting", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Access Gateway", permission: "Gmail draft-only", memory: "None", cost: "$0.00", decision: "approved" }
];

const simulatedRunEvents: AuditEvent[] = [
  { event: "Job Discovery Agent searched 12 roles", type: "MCP/tool use", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "search", memory: "Job Search Memory", cost: "$0.09", decision: "allowed" },
  { event: "Company Research Agent summarized 3 companies", type: "A2A handoff", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "write notes", memory: "Research Memory", cost: "$0.18", decision: "allowed" },
  { event: "Resume Tailoring Agent read Resume Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Resume Memory", cost: "$0.02", decision: "allowed" },
  { event: "Resume Tailoring Agent created a resume draft and requires approval", type: "approval request", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Docs / Notion MCP", permission: "create draft", memory: "Resume Memory", cost: "$0.24", decision: "approval_required" },
  { event: "Outreach Draft Agent created 3 Gmail drafts and requires approval", type: "approval request", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail draft-only MCP", permission: "create drafts", memory: "Research Memory", cost: "$0.11", decision: "approval_required" },
  { event: "Policy Engine blocked direct application submission", type: "blocked action", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Policy Engine", permission: "apply to job", memory: "Job Search Memory", cost: "$0.00", decision: "blocked" },
  { event: "Memory Firewall limited Outreach Agent to Job Search Memory", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "scope memory", memory: "Job Search Memory", cost: "$0.00", decision: "allowed" },
  { event: "Access Gateway minted temporary model access", type: "credential minting", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Access Gateway", permission: "temporary model access", memory: "None", cost: "$0.00", decision: "approved" },
  { event: "Spend increased by $0.64 for Job Search Automation", type: "spend event", agent: "AgentDock Orchestration Agent", workflow: "Job Search Automation", tool: "Spend Monitor", permission: "budget debit", memory: "None", cost: "$0.64", decision: "allowed" }
];

const credentials = [
  { provider: "OpenAI", agent: "Job Discovery Agent", workflow: "Job Search Automation", scope: "Model calls within $5 weekly cap", expiry: "7 days", status: "Active" },
  { provider: "Anthropic", agent: "Company Research Agent", workflow: "Job Search Automation", scope: "Research summaries only", expiry: "7 days", status: "Active" },
  { provider: "Gemini", agent: "Outreach Draft Agent", workflow: "Job Search Automation", scope: "Draft generation only", expiry: "24 hours", status: "Active" },
  { provider: "Google Workspace", agent: "Outreach Draft Agent", workflow: "Job Search Automation", scope: "Gmail drafts; send blocked", expiry: "24 hours", status: "Approval gated" },
  { provider: "GitHub", agent: "Code Review Agent", workflow: "Coding Review Stack", scope: "Read repos; draft comments", expiry: "Paused", status: "Paused" }
];

const providerUsage = [
  { provider: "OpenAI", usage: "$1.12", cap: "$3.00" },
  { provider: "Anthropic", usage: "$0.54", cap: "$2.00" },
  { provider: "Gemini", usage: "$0.31", cap: "$1.50" },
  { provider: "Google Workspace", usage: "$0.00", cap: "Draft-only" }
];

const runtimeModes: RuntimeMode[] = [
  {
    name: "Provider API Mode",
    description: "Calls frontier model APIs through AgentDock’s credential gateway.",
    bestFor: "Quality and simplicity.",
    status: "Available"
  },
  {
    name: "AgentDock Sandbox Mode",
    description: "Runs agent workflows in an isolated AgentDock-managed environment.",
    bestFor: "Scoped credentials, MCP access, logs, and approval gates.",
    status: "Selected for Job Search Automation"
  },
  {
    name: "User Cloud Mode",
    description: "Runs in the customer’s own cloud/VPC later.",
    bestFor: "Enterprise/private deployments.",
    status: "Later"
  },
  {
    name: "Local Mode",
    description: "Runs on the user’s machine later.",
    bestFor: "Privacy/power users.",
    status: "Later"
  }
];

const builderControls: ControlComponent[] = [
  { name: "A2UI Approval Gate", riskLevel: "Low", permissions: "Approves drafts, sends, exports, and applications", memoryAccess: "Reads policy context only", budgetImpact: "$0.00", approvalMode: "Human approval required" },
  { name: "Budget Cap", riskLevel: "Low", permissions: "Pauses workflow before spend limit", memoryAccess: "No memory access", budgetImpact: "$5/week", approvalMode: "Automatic enforcement" },
  { name: "Human Review", riskLevel: "Low", permissions: "Queues artifacts before external action", memoryAccess: "Scoped artifact preview", budgetImpact: "$0.00", approvalMode: "Manual review" },
  { name: "Blocked Action", riskLevel: "Medium", permissions: "Blocks sends, payments, broad exports, and applications", memoryAccess: "No memory access", budgetImpact: "$0.00", approvalMode: "Always blocked" },
  { name: "Scoped Credential", riskLevel: "Medium", permissions: "Temporary model/tool credential metadata", memoryAccess: "No memory access", budgetImpact: "Routes through cap", approvalMode: "Policy-gated" },
  { name: "Memory Firewall", riskLevel: "Low", permissions: "Enforces read/write/share/delete grants", memoryAccess: "Partition-aware", budgetImpact: "$0.00", approvalMode: "Policy-gated" }
];

const recommendedBuilderNodes: BuilderNode[] = [
  { id: "goal-job-search", name: "User Goal", type: "goal", category: "Workflow intent", permissions: "Defines requested outcome", memoryAccess: "No direct memory access", budgetImpact: "$0.00", approvalMode: "User-authored", attachments: ["Help me manage job applications and outreach without sending emails or applying automatically."] },
  { id: "agent-job-discovery", name: "Job Discovery Agent", type: "agent", provider: "OpenAI", category: "Discovery", trustScore: 96, permissions: "Search roles, rank fit, write targets", memoryAccess: "Job Search Memory: read/write", budgetImpact: "$0.09/task", approvalMode: "Autonomous discovery", attachments: ["Search MCP", "Job Search Memory"] },
  { id: "agent-company-research", name: "Company Research Agent", type: "agent", provider: "Claude", category: "Research", trustScore: 92, permissions: "Summarize companies, write research notes", memoryAccess: "Research Memory: read/write", budgetImpact: "$0.18/task", approvalMode: "Human-reviewed notes", attachments: ["Search MCP", "Research Memory"] },
  { id: "agent-resume-tailoring", name: "Resume Tailoring Agent", type: "agent", provider: "OpenAI", category: "Documents", trustScore: 89, permissions: "Create resume drafts", memoryAccess: "Resume Memory: read/write", budgetImpact: "$0.24/task", approvalMode: "Approval before export", attachments: ["Docs / Notion MCP", "Resume Memory"] },
  { id: "agent-outreach-draft", name: "Outreach Draft Agent", type: "agent", provider: "Gemini", category: "Communications", trustScore: 94, permissions: "Create Gmail drafts only", memoryAccess: "Job Search Memory: read, Outreach History: write", budgetImpact: "$0.11/task", approvalMode: "Never send without approval", attachments: ["Gmail Draft MCP", "Job Search Memory"] },
  { id: "control-approval-gate", name: "A2UI Approval Gate", type: "control", category: "Control", riskLevel: "Low", permissions: "Send/apply actions require user approval", memoryAccess: "Policy context only", budgetImpact: "$0.00", approvalMode: "2 approval gates", attachments: ["Send/apply actions require user approval"] }
];

const builderSimulateEvents: AuditEvent[] = [
  { event: "Orchestration Agent recommended Job Search stack", type: "A2A handoff", agent: "AgentDock Orchestration Agent", workflow: "Job Search Automation", tool: "Build", permission: "recommend stack", memory: "Job Search Memory", cost: "$0.00", decision: "allowed" },
  { event: "Job Discovery Agent searched 12 roles", type: "MCP/tool use", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "search", memory: "Job Search Memory", cost: "$0.09", decision: "allowed" },
  { event: "Company Research Agent summarized 3 companies", type: "A2A handoff", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "write notes", memory: "Research Memory", cost: "$0.18", decision: "allowed" },
  { event: "Resume Tailoring Agent read Resume Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Resume Memory", cost: "$0.02", decision: "allowed" },
  { event: "Outreach Draft Agent requested Gmail draft access", type: "approval request", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail Draft MCP", permission: "create drafts", memory: "Job Search Memory", cost: "$0.11", decision: "approval_required" },
  { event: "Approval Gate created 3 pending approvals", type: "approval request", agent: "Approval Gate", workflow: "Job Search Automation", tool: "Control", permission: "human review", memory: "None", cost: "$0.00", decision: "approval_required" },
  { event: "Policy Engine blocked direct application submission", type: "blocked action", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Policy Engine", permission: "apply to job", memory: "Job Search Memory", cost: "$0.00", decision: "blocked" },
  { event: "Memory Firewall blocked unrelated Finance Memory access", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Finance Memory", cost: "$0.00", decision: "blocked" },
  { event: "Access Gateway minted temporary scoped access", type: "credential minting", agent: "AgentDock Orchestration Agent", workflow: "Job Search Automation", tool: "Access Gateway", permission: "temporary model/tool access", memory: "None", cost: "$0.00", decision: "approved" }
];

const jobSearchWorkflowPayload = {
  name: "Job Search Automation",
  goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 150,
  approvalMode: "approval_gated",
  agents: [
    { agentName: "Job Discovery Agent", roleInWorkflow: "Discover roles", routeOrder: 1, defaultMode: "Autonomous discovery" },
    { agentName: "Company Research Agent", roleInWorkflow: "Research targets", routeOrder: 2, defaultMode: "Human-reviewed notes" },
    { agentName: "Resume Tailoring Agent", roleInWorkflow: "Tailor resume", routeOrder: 3, defaultMode: "Approval before export" },
    { agentName: "Outreach Draft Agent", roleInWorkflow: "Draft outreach", routeOrder: 4, defaultMode: "Draft-only" }
  ]
};

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const eventTypeLabels: Record<string, EventType> = {
  orchestration: "A2A handoff",
  a2a_handoff: "A2A handoff",
  mcp_tool_use: "MCP/tool use",
  memory_access: "memory access",
  credential_minted: "credential minting",
  approval_requested: "approval request",
  action_blocked: "blocked action",
  spend_event: "spend event",
  workflow_completed: "A2A handoff"
};

function activityLogToAuditEvent(log: PersistedActivityLog): AuditEvent {
  return {
    event: log.title,
    type: eventTypeLabels[log.eventType] ?? "A2A handoff",
    agent: log.agent?.name ?? "AgentDock Orchestration Agent",
    workflow: log.workflow?.name ?? (typeof log.metadata?.workflowName === "string" ? log.metadata.workflowName : "Job Search Automation"),
    tool: typeof log.metadata?.mcpName === "string"
      ? log.metadata.mcpName
      : typeof log.metadata?.mcpTool === "string"
        ? log.metadata.mcpTool
        : "Policy Gateway",
    permission: log.eventType.replaceAll("_", " "),
    memory: typeof log.metadata?.partitionName === "string"
      ? log.metadata.partitionName
      : typeof log.metadata?.memoryPartitionId === "string"
        ? "Memory partition"
        : "None",
    cost: formatCents(log.costCents),
    decision: log.decision ?? "info"
  };
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<Section>("Build");
  const [storeTab, setStoreTab] = useState<StoreTab>("Agents");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("My Flows");
  const [builderPaletteTab, setBuilderPaletteTab] = useState<BuilderPaletteTab>("Agents");
  const [builderPrompt, setBuilderPrompt] = useState("Find jobs, research companies, tailor resumes, and draft outreach. Do not send or apply without me.");
  const [builderNodes, setBuilderNodes] = useState<BuilderNode[]>([recommendedBuilderNodes[0]]);
  const [selectedBuilderNodeId, setSelectedBuilderNodeId] = useState(recommendedBuilderNodes[0].id);
  const [builderSaved, setBuilderSaved] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState("Job Search Memory");
  const [defaultAgent, setDefaultAgent] = useState("Job Discovery Agent");
  const [events, setEvents] = useState<AuditEvent[]>(baseAuditEvents);
  const [spend, setSpend] = useState(2.15);
  const [runCount, setRunCount] = useState(0);
  const [runHistory, setRunHistory] = useState<string[]>([
    "Initial demo run: 12 roles searched, 3 companies summarized, 2 approval gates opened."
  ]);

  const pendingApprovals = useMemo(
    () => events.filter((event) => event.decision === "approval_required").length + 3,
    [events]
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSection]);

  const runDemoWorkflow = () => {
    setRunCount((count) => count + 1);
    setSpend((value) => Number((value + 0.64).toFixed(2)));
    setRunHistory((current) => [
      `Run ${runCount + 1}: 12 roles searched, 3 companies summarized, resume draft and 3 Gmail drafts queued for approval.`,
      ...current
    ]);
    setEvents((current) => [
      ...simulatedRunEvents.map((event, index) => ({
        ...event,
        event: runCount > 0 ? `${event.event} (run ${runCount + 1})` : event.event,
        cost: index === 0 && runCount > 0 ? "$0.10" : event.cost
      })),
      ...current
    ]);
    setActiveSection("Control");
  };

  const recommendBuilderStack = () => {
    setBuilderNodes(recommendedBuilderNodes);
    setSelectedBuilderNodeId("agent-job-discovery");
    setBuilderSaved(false);
  };

  const addBuilderNode = (node: BuilderNode) => {
    setBuilderNodes((current) => {
      const uniqueId = `${node.id}-${current.length + 1}`;
      const nextNode = current.some((item) => item.id === node.id) ? { ...node, id: uniqueId } : node;
      setSelectedBuilderNodeId(nextNode.id);
      return [...current, nextNode];
    });
    setBuilderSaved(false);
  };

  const removeBuilderNode = (id: string) => {
    setBuilderNodes((current) => {
      const next = current.filter((node) => node.id !== id || node.type === "goal");
      setSelectedBuilderNodeId(next[0]?.id ?? recommendedBuilderNodes[0].id);
      return next.length ? next : [recommendedBuilderNodes[0]];
    });
    setBuilderSaved(false);
  };

  const saveBuilderWorkflow = () => {
    setBuilderSaved(true);
    setRunHistory((current) => [
      `Builder saved Job Search Automation with ${builderNodes.length} components, $5/week cap, and approval-gated sends/applications.`,
      ...current
    ]);
  };

  const simulateBuilderRun = () => {
    setBuilderSaved(true);
    setSpend((value) => Number((value + 0.71).toFixed(2)));
    setRunCount((count) => count + 1);
    setRunHistory((current) => [
      `Builder simulation ${runCount + 1}: recommended stack ran through search, research, resume memory, Gmail draft access, and policy blocks.`,
      ...current
    ]);
    setEvents((current) => [
      ...builderSimulateEvents.map((event) => ({
        ...event,
        event: runCount > 0 ? `${event.event} (builder run ${runCount + 1})` : event.event
      })),
      ...current
    ]);
  };

  const simulateUnsafeAction = () => {
    setEvents((current) => [
      {
        event: "Outreach Draft Agent attempted to send email - blocked by Policy Engine and added to Approval Inbox",
        type: "blocked action",
        agent: "Outreach Draft Agent",
        workflow: "Job Search Automation",
        tool: "Gmail Draft MCP",
        permission: "send email",
        memory: "Job Search Memory",
        cost: "$0.00",
        decision: "approval_required"
      },
      ...current
    ]);
  };

  return (
    <SessionProvider>
      <main className="shell platformShell">
      <nav className="topbar platformTopbar" aria-label="Platform">
        <div className="brand">
          <span className="brandMark">AD</span>
          <span>AgentDock</span>
        </div>
        <div className="navLinks platformNav">
          {sections.map((section) => (
            <button
              className={activeSection === section ? "navButton active" : "navButton"}
              key={section}
              onClick={() => setActiveSection(section)}
            >
              {section}
            </button>
          ))}
        </div>
        <AuthStatus />
      </nav>

      {activeSection === "Control" && (
        <ControlPlane
          events={events}
          spend={spend}
          pendingApprovals={pendingApprovals}
          defaultAgent={defaultAgent}
          runHistory={runHistory}
          onRun={runDemoWorkflow}
          onOpenSection={setActiveSection}
        />
      )}
      {activeSection === "Build" && (
        <Builder
          prompt={builderPrompt}
          setPrompt={setBuilderPrompt}
          nodes={builderNodes}
          selectedNodeId={selectedBuilderNodeId}
          setSelectedNodeId={setSelectedBuilderNodeId}
          saved={builderSaved}
          onRecommend={recommendBuilderStack}
          onAddNode={addBuilderNode}
          onRemoveNode={removeBuilderNode}
          onSave={saveBuilderWorkflow}
          onSimulate={simulateBuilderRun}
          onUnsafeSimulate={simulateUnsafeAction}
          onViewLogs={() => setActiveSection("Control")}
          onSetDefault={setDefaultAgent}
        />
      )}
      {activeSection === "Store" && (
        <Store
          tab={storeTab}
          setTab={setStoreTab}
          defaultAgent={defaultAgent}
          setDefaultAgent={setDefaultAgent}
        />
      )}
      {activeSection === "Flows" && (
        <Library
          tab={libraryTab}
          setTab={setLibraryTab}
          spend={spend}
        />
      )}
      {activeSection === "Profile" && (
        <Profile
          selectedMemory={selectedMemory}
          onSelectMemory={setSelectedMemory}
          defaultAgent={defaultAgent}
        />
      )}
      </main>
    </SessionProvider>
  );
}

function AuthStatus() {
  const { data: session, status } = useSession();
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getProviders()
      .then((providers) => setGoogleAvailable(Boolean(providers?.google)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  if (status === "loading") {
    return <button className="authTrigger" disabled>Checking...</button>;
  }

  if (session?.user) {
    return (
      <div className="authMenu">
        <button className="authTrigger signedIn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {session.user.image ? <img src={session.user.image} alt="" /> : <span className="authAvatar">AD</span>}
          <span>{session.user.name ?? "Signed in"}</span>
        </button>
        {open && (
          <div className="authPopover">
            <div className="authPopoverHeader">
              {session.user.image ? <img src={session.user.image} alt="" /> : <span className="authAvatar large">AD</span>}
              <div>
                <strong>{session.user.name ?? "AgentDock user"}</strong>
                <span>Signed in as {session.user.email ?? session.user.name}</span>
              </div>
            </div>
            <button className="secondaryButton smallButton" onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="authMenu">
      <button className="authTrigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Sign in
      </button>
      {open && (
        <div className="authPopover">
          <div>
            <strong>Save your AgentDock workspace</strong>
            <p>Sign in to save Flows, Memory Zones, access, and Timeline.</p>
          </div>
          {googleAvailable ? (
            <button className="googleSignInButton" onClick={() => signIn("google")}>
              <span>G</span>
              Sign in with Google
            </button>
          ) : (
            <p className="authSetupText">Set Google OAuth env vars to enable sign-in.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ControlPlane({
  events,
  spend,
  pendingApprovals,
  defaultAgent,
  runHistory,
  onRun,
  onOpenSection
}: {
  events: AuditEvent[];
  spend: number;
  pendingApprovals: number;
  defaultAgent: string;
  runHistory: string[];
  onRun: () => void;
  onOpenSection: (section: Section) => void;
}) {
  const { data: session } = useSession();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<PersistedWorkflowRun[]>([]);
  const [dbApprovals, setDbApprovals] = useState<PersistedApprovalRequest[]>([]);
  const [controlMessage, setControlMessage] = useState("");
  const [runningControlSimulation, setRunningControlSimulation] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");

  const loadControlPlaneData = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      setWorkflowRuns([]);
      setDbApprovals([]);
      return;
    }

    try {
      const [workflowsResponse, runsResponse] = await Promise.all([
        fetch("/api/workflows"),
        fetch("/api/workflow-runs")
      ]);
      const workflowsData = await workflowsResponse.json();
      const runsData = await runsResponse.json();

      if (!workflowsResponse.ok) {
        throw new Error(workflowsData.message ?? "Unable to load saved Flows.");
      }
      if (!runsResponse.ok) {
        throw new Error(runsData.message ?? "Unable to load runs.");
      }

      const runs: PersistedWorkflowRun[] = runsData.workflowRuns ?? [];
      setSavedWorkflows(workflowsData.workflows ?? []);
      setWorkflowRuns(runs);
      setDbApprovals(runs.flatMap((run) => run.approvalRequests).filter((approval) => approval.status === "pending"));
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Unable to load Control data.");
    }
  };

  useEffect(() => {
    loadControlPlaneData();
  }, [session?.user?.email]);

  const runControlPlaneWorkflow = async () => {
    if (!session?.user) {
      onRun();
      return;
    }

    const workflow = savedWorkflows.find((item) => item.name === "Job Search Automation") ?? savedWorkflows[0];

    if (!workflow?.id) {
      setControlMessage("Save this Flow first to run a DB-backed preview.");
      return;
    }

    setRunningControlSimulation(true);
    setControlMessage("");

    try {
      const response = await fetch("/api/workflow-runs/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: workflow.id })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Run preview failed.");
      }

      setControlMessage(`DB-backed run created: ${data.workflowRun.events.length} events and ${data.workflowRun.approvalRequests.length} approvals.`);
      await loadControlPlaneData();
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Run preview failed.");
    } finally {
      setRunningControlSimulation(false);
    }
  };

  const resolveControlApproval = async (approvalId: string, status: "approved" | "denied" | "edited") => {
    setResolvingApprovalId(approvalId);
    setControlMessage("");

    try {
      const response = await fetch(`/api/approvals/${approvalId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to resolve approval.");
      }

      setControlMessage(`Approval ${status} and written to Timeline.`);
      await loadControlPlaneData();
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Unable to resolve approval.");
    } finally {
      setResolvingApprovalId("");
    }
  };

  const latestRun = workflowRuns[0];
  const hasActiveRun = Boolean(latestRun) || !session?.user;
  const timelineItems = latestRun?.events?.length
    ? latestRun.events.slice(0, 6).map((event) => event.title)
    : session?.user ? [] : [
      "Job Discovery searched 12 roles",
      "Company Research summarized 3 companies",
      "Resume draft created",
      "Outreach drafts require approval",
      "Direct email send blocked by Policy Engine"
    ];

  return (
    <section className="platformPage controlPlanePage">
      <PageHeader
        eyebrow="Control"
        title="Control"
        copy="Approvals, blocks, spend, and timeline."
      />
      <div className="truthNotice">
        <CapabilityBadge kind={session?.user ? "db" : "mock"} />
        <strong>{session?.user ? "DB-backed mode active." : "You are in demo mode."}</strong>
        <span>Runs, approvals, and Timeline save when signed in. Real execution stays off.</span>
      </div>
      {controlMessage && <div className="profileAuthNotice compactNotice">{controlMessage}</div>}

      <div className="controlGrid">
        <Card title="Active run" meta={latestRun?.status?.replaceAll("_", " ") ?? (session?.user ? "None yet" : "Demo ready")}>
          {hasActiveRun ? (
            <div className="activeRunCard">
              <strong>{latestRun?.workflow.name ?? "Job Search Automation"}</strong>
              <div className="runMetricGrid">
                <Metric label="Spend" value={latestRun ? formatCents(latestRun.totalCostCents) : `$${spend.toFixed(2)} / $5.00`} />
                <Metric label="Pending approvals" value={`${dbApprovals.length || pendingApprovals}`} />
                <Metric label="Last run" value={latestRun ? new Date(latestRun.startedAt).toLocaleString() : runHistory[0] ?? "Not run yet"} />
              </div>
              <div className="heroActions compactActions">
                <button className="primaryButton" onClick={runControlPlaneWorkflow} disabled={runningControlSimulation}>
                  {runningControlSimulation ? "Running..." : "Run Preview"}
                </button>
                <button className="secondaryButton" onClick={() => onOpenSection("Build")}>Open Build</button>
              </div>
            </div>
          ) : (
            <div className="emptyWorkflowState">
              <strong>No run yet.</strong>
              <p>Save a Flow in Build, then run a preview.</p>
              <button className="primaryButton" onClick={() => onOpenSection("Build")}>Open Build</button>
            </div>
          )}
        </Card>
        <Card title="Timeline" meta={latestRun ? `${latestRun.events.length} events` : session?.user ? "No run yet" : "Mock preview"}>
          {timelineItems.length ? (
            <div className="runTimeline">
              {timelineItems.map((item, index) => (
              <div className="runTimelineItem" key={`${item}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </div>
              ))}
            </div>
          ) : (
            <div className="emptyWorkflowState">
              <strong>No timeline yet.</strong>
              <p>Run a preview to see events here.</p>
            </div>
          )}
        </Card>
        <ApprovalInbox
          items={["Review resume draft", "Approve 3 Gmail drafts", "Company Preferences access request", "Direct application submission blocked"]}
          approvals={dbApprovals}
          onResolve={resolveControlApproval}
          resolvingApprovalId={resolvingApprovalId}
          dbBacked={Boolean(session?.user && dbApprovals.length)}
        />
        <Card title="Recent Timeline" meta="Latest 5">
          <AuditList events={events.slice(0, 5)} compact />
          <div className="heroActions compactActions">
            <button className="secondaryButton" onClick={() => onOpenSection("Flows")}>View Flows</button>
          </div>
        </Card>
        <Card title="Spend" meta="$5 weekly cap">
          <div className="costWidget inlineCost">
            <span>Job Search Automation</span>
            <strong>${spend.toFixed(2)} / $5.00</strong>
            <div className="meter"><span style={{ width: `${Math.min(100, (spend / 5) * 100)}%` }} /></div>
          </div>
          <div className="softNote">Runs pause before the cap.</div>
        </Card>
        <Card title="Revoke" meta="Scoped">
          <DetailBlock label="Memory" value="Profile controls Memory Zones" />
          <DetailBlock label="Tools" value="Flow tool access lives in Flows" />
          <DetailBlock label="Access" value="Scoped Access lives in Flows" />
        </Card>
      </div>
    </section>
  );
}

function Builder({
  prompt,
  setPrompt,
  nodes,
  selectedNodeId,
  setSelectedNodeId,
  saved,
  onRecommend,
  onAddNode,
  onRemoveNode,
  onSave,
  onSimulate,
  onUnsafeSimulate,
  onViewLogs,
  onSetDefault
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  nodes: BuilderNode[];
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  saved: boolean;
  onRecommend: () => void;
  onAddNode: (node: BuilderNode) => void;
  onRemoveNode: (id: string) => void;
  onSave: () => void;
  onSimulate: () => void;
  onUnsafeSimulate: () => void;
  onViewLogs: () => void;
  onSetDefault: (agent: string) => void;
}) {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? recommendedBuilderNodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const { data: session } = useSession();
  const [builderMode, setBuilderMode] = useState<BuilderMode>("empty");
  const [savedWorkflowId, setSavedWorkflowId] = useState("");
  const [builderNotice, setBuilderNotice] = useState("No Flow yet. Describe the job or load a template.");
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [unsafeSimulation, setUnsafeSimulation] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<PersistedWorkflowRun[]>([]);
  const [dbApprovals, setDbApprovals] = useState<PersistedApprovalRequest[]>([]);
  const [mcpServers, setMcpServers] = useState<PersistedMcpServer[]>([]);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [runningSimulation, setRunningSimulation] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");
  const [attachingMcpId, setAttachingMcpId] = useState("");
  const recommendedReady = nodes.length > 1;
  const approvalItems = [
    "Review resume draft",
    "Approve 3 Gmail drafts",
    "Company Preferences access request",
    "Direct application submission blocked"
  ];
  const policyDiffs = [
    "Gmail send access changed to blocked",
    "Application submission changed to approval required",
    "Finance Memory blocked",
    "Health Memory blocked",
    "Weekly spend capped at $5",
    "Premium models require approval above cap"
  ];
  const validationChecks = [
    "Email sending is blocked",
    "Job applications require approval",
    "Gmail access is draft-only",
    "Finance and Health Memory are blocked",
    "All handoffs will be logged",
    "Scoped Access required for models and tools"
  ];
  const savedJobSearchWorkflow = savedWorkflows.find((workflow) => workflow.name === "Job Search Automation") ?? savedWorkflows[0];
  const selectedMcpGrant = selectedNode?.type === "mcp"
    ? savedJobSearchWorkflow?.mcpAccessGrants?.find((grant) => grant.mcpServer.displayName === selectedNode.name)
    : undefined;
  const attachedMcpNames = new Set(savedJobSearchWorkflow?.workflowMcps?.map((workflowMcp) => workflowMcp.mcpServer.displayName) ?? []);
  const hasDraftWorkflow = builderMode !== "empty";
  const generatedNodes = hasDraftWorkflow ? nodes : [];
  const currentWorkflow = savedWorkflowId
    ? savedWorkflows.find((workflow) => workflow.id === savedWorkflowId) ?? savedJobSearchWorkflow
    : savedJobSearchWorkflow;

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    try {
      const response = await fetch("/api/workflows");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load saved Flows.");
      }

      const workflows = data.workflows ?? [];
      setSavedWorkflows(workflows);

      const activeWorkflow = (savedWorkflowId ? workflows.find((workflow: PersistedWorkflow) => workflow.id === savedWorkflowId) : null)
        ?? workflows.find((workflow: PersistedWorkflow) => workflow.name === "Job Search Automation")
        ?? workflows[0];
      for (const workflowMcp of activeWorkflow?.workflowMcps ?? []) {
        if (!nodes.some((node) => node.name === workflowMcp.mcpServer.displayName)) {
          onAddNode({
            id: `mcp-${workflowMcp.mcpServer.name}`,
            name: workflowMcp.mcpServer.displayName,
            type: "mcp",
            category: workflowMcp.mcpServer.category ?? "Tool",
            riskLevel: workflowMcp.mcpServer.riskLevel,
            permissions: `${workflowMcp.defaultPermission.replaceAll("_", " ")} permission template`,
            memoryAccess: "No memory access by default",
            budgetImpact: "$0.00 metadata only",
            approvalMode: workflowMcp.mcpServer.riskLevel === "low" ? "Flow scoped" : "Approval gated",
            attachments: ["DB-backed tool", workflowMcp.purpose ?? "Flow-scoped tool metadata"]
          });
        }
      }
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Unable to load saved Flows. Mock planner remains available.");
    }
  };

  const loadWorkflowRuns = async () => {
    if (!session?.user) {
      setWorkflowRuns([]);
      setDbApprovals([]);
      return;
    }

    try {
      const response = await fetch("/api/workflow-runs");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load runs.");
      }

      const runs = data.workflowRuns ?? [];
      setWorkflowRuns(runs);
      setDbApprovals(
        runs
          .flatMap((run: PersistedWorkflowRun) => run.approvalRequests)
          .filter((approval: PersistedApprovalRequest) => approval.status === "pending")
      );
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Unable to load runs. Mock planner remains available.");
    }
  };

  const loadMcpServers = async () => {
    if (!session?.user) {
      setMcpServers([]);
      return;
    }

    try {
      const response = await fetch("/api/mcp/servers");
      const data = await response.json();

      if (response.ok) {
        setMcpServers(data.servers ?? []);
      }
    } catch {
      setMcpServers([]);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
    loadWorkflowRuns();
    loadMcpServers();
  }, [session?.user?.email]);

  const generateWorkflowDraft = (source: "goal" | "template") => {
    onRecommend();
    setBuilderMode("draft");
    setSavedWorkflowId("");
    setUnsafeSimulation(false);
    setRuntimeMessage("");
    setSaveMessage("");
    setBuilderNotice(source === "template"
      ? "Template loaded as draft — save to Flows to run."
      : "Draft Flow — not saved.");
  };

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      setSaveMessage("Sign in to save this Flow to Flows.");
      return;
    }

    if (!hasDraftWorkflow) {
      setSaveMessage("Generate or load a Flow before saving.");
      return;
    }

    setSavingWorkflow(true);
    setSaveMessage("");

    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobSearchWorkflowPayload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Flow save failed.");
      }

      onSave();
      setBuilderMode("saved");
      setSavedWorkflowId(data.workflow?.id ?? "");
      setBuilderNotice("Saved Flow — ready to run.");
      setSaveMessage("Flow saved to Flows.");
      await loadSavedWorkflows();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Flow save failed.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  const simulateDatabaseRun = async (mode: "run" | "unsafe") => {
    if (!session?.user) {
      if (!hasDraftWorkflow) {
        setRuntimeMessage("Generate or load a Flow before running a local preview.");
        return;
      }
      if (mode === "unsafe") {
        setUnsafeSimulation(true);
        onUnsafeSimulate();
      } else {
        onSimulate();
      }
      setBuilderMode("approval_pending");
      setRuntimeMessage("Local preview run. Sign in to save runs, approvals, and Timeline.");
      return;
    }

    const workflowId = savedWorkflowId || currentWorkflow?.id || "";

    if (!workflowId || builderMode === "draft" || builderMode === "empty") {
      setRuntimeMessage("Save this Flow first to run a DB-backed preview.");
      return;
    }

    setRunningSimulation(true);
    setBuilderMode("running");
    setRuntimeMessage("");

    try {
      const response = await fetch("/api/workflow-runs/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Run preview failed.");
      }

      const workflowRun = data.workflowRun as PersistedWorkflowRun;
      setWorkflowRuns((current) => [workflowRun, ...current]);
      setDbApprovals(workflowRun.approvalRequests.filter((approval) => approval.status === "pending"));
      setBuilderMode("approval_pending");
      setRuntimeMessage("Run saved. Approvals and Timeline updated.");
      if (mode === "unsafe") {
        setUnsafeSimulation(true);
      }
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Run preview failed.");
    } finally {
      setRunningSimulation(false);
    }
  };

  const simulateUnsafeAction = () => {
    setUnsafeSimulation(true);
    simulateDatabaseRun("unsafe");
  };

  const editSavedWorkflow = () => {
    if (!hasDraftWorkflow) {
      generateWorkflowDraft("template");
      return;
    }

    setBuilderMode("draft");
    setBuilderNotice("Editing locally — save creates or updates the Flow.");
    setRuntimeMessage("Local edit mode. Persist changes with Save Flow.");
  };

  const resolveApproval = async (approvalId: string, status: "approved" | "denied" | "edited") => {
    if (!session?.user) {
      setRuntimeMessage(`Mock approval marked ${status}. Sign in to persist decisions.`);
      return;
    }

    setResolvingApprovalId(approvalId);
    setRuntimeMessage("");

    try {
      const response = await fetch(`/api/approvals/${approvalId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Approval update failed.");
      }

      setDbApprovals((current) => current.filter((approval) => approval.id !== approvalId));
      setRuntimeMessage(`Approval ${status} and written to Timeline.`);
      await loadWorkflowRuns();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Approval update failed.");
    } finally {
      setResolvingApprovalId("");
    }
  };

  const addMcpVisualNode = (server: PersistedMcpServer) => {
    onAddNode({
      id: `mcp-${server.name}`,
      name: server.displayName,
      type: "mcp",
      category: server.category ?? "Tool",
      riskLevel: server.riskLevel,
      permissions: `${(server.metadata?.recommendedPermission ?? "approval_required").replaceAll("_", " ")} permission template`,
      memoryAccess: "No memory access by default",
      budgetImpact: "$0.00 metadata only",
      approvalMode: server.riskLevel === "low" ? "Allowed inside Flow scope" : "Approval gated",
      attachments: [`${server.tools?.length ?? 0} tool metadata records`, "No execution in Phase 1"]
    });
  };

  const attachBuilderMcp = async (server: PersistedMcpServer) => {
    if (!session?.user) {
      setRuntimeMessage("Sign in with Google to add tools to a saved Flow.");
      return;
    }

    const workflowForAttachment = savedWorkflowId
      ? savedWorkflows.find((workflow) => workflow.id === savedWorkflowId)
      : savedJobSearchWorkflow;

    if (!workflowForAttachment?.id) {
      setRuntimeMessage("Save this Flow first to add tools.");
      return;
    }

    const defaultPermission = server.metadata?.recommendedPermission ?? (server.riskLevel === "low" ? "read_only" : server.riskLevel === "high" ? "draft_only" : server.riskLevel === "restricted" ? "blocked" : "approval_required");
    setAttachingMcpId(server.id);
    setRuntimeMessage("");

    try {
      const response = await fetch(`/api/workflows/${workflowForAttachment.id}/mcps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcpServerId: server.id,
          purpose: `${server.displayName} scoped to ${workflowForAttachment.name}`,
          defaultPermission
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to add tool to Flow.");
      }

      addMcpVisualNode(server);
      setRuntimeMessage(`${server.displayName} added with ${defaultPermission.replaceAll("_", " ")} access.`);
      await loadSavedWorkflows();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Unable to add tool to Flow.");
    } finally {
      setAttachingMcpId("");
    }
  };

  const updateMcpGrant = async (grant: PersistedMcpAccessGrant, field: "canRead" | "canWrite" | "canExecute" | "canDelete" | "requiresApproval") => {
    setAttachingMcpId(grant.mcpServer.id);
    setRuntimeMessage("");

    try {
      const response = await fetch(`/api/mcp/grants/${grant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !grant[field] })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to update tool access.");
      }

      setRuntimeMessage("Tool access updated and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Unable to update tool access.");
    } finally {
      setAttachingMcpId("");
    }
  };

  const revokeMcpGrant = async (grant: PersistedMcpAccessGrant) => {
    setAttachingMcpId(grant.mcpServer.id);
    setRuntimeMessage("");

    try {
      const response = await fetch(`/api/mcp/grants/${grant.id}/revoke`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to revoke tool.");
      }

      setRuntimeMessage("Tool revoked and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "Unable to revoke tool.");
    } finally {
      setAttachingMcpId("");
    }
  };

  const visibleNodes = hasDraftWorkflow ? generatedNodes : [];
  const activeSelectedNode = hasDraftWorkflow ? selectedNode : undefined;
  const workflowStepDetails: Record<string, { purpose: string; uses: string; allowed: string; blocked: string; status: string }> = {
    "User Goal": {
      purpose: "The job in one sentence.",
      uses: "Goal prompt",
      allowed: "Plan a Flow",
      blocked: "Run agents",
      status: "Draft"
    },
    "Job Discovery Agent": {
      purpose: "Finds high-fit roles.",
      uses: "Search, Job Search",
      allowed: "Search, write notes",
      blocked: "Apply",
      status: "Ready"
    },
    "Company Research Agent": {
      purpose: "Summarizes companies.",
      uses: "Search, Research",
      allowed: "Read/write notes",
      blocked: "Share",
      status: "Ready"
    },
    "Resume Tailoring Agent": {
      purpose: "Creates tailored drafts.",
      uses: "Docs, Resume",
      allowed: "Draft",
      blocked: "Overwrite",
      status: "Approval gated"
    },
    "Outreach Draft Agent": {
      purpose: "Drafts messages.",
      uses: "Gmail Drafts, Job Search",
      allowed: "Draft",
      blocked: "Send",
      status: "Approval gated"
    },
    "A2UI Approval Gate": {
      purpose: "You review before anything leaves.",
      uses: "Approvals, Policy",
      allowed: "Approve, deny, edit",
      blocked: "Silent sends",
      status: "Required"
    }
  };
  const selectedStepDetails = workflowStepDetails[activeSelectedNode?.name ?? ""] ?? {
    purpose: activeSelectedNode?.approvalMode ?? "Flow component.",
    uses: activeSelectedNode?.attachments?.join(", ") || "Flow context",
    allowed: activeSelectedNode?.permissions ?? "Scoped by policy",
    blocked: activeSelectedNode?.approvalMode ?? "Unsafe defaults",
    status: activeSelectedNode?.type === "mcp" ? "Metadata only" : "Preview"
  };
  const modeLabels: Record<BuilderMode, string> = {
    empty: "Empty workspace",
    draft: "Draft Flow — not saved",
    saved: "Saved Flow — DB-backed",
    running: "Running preview",
    approval_pending: "Approval pending"
  };

  return (
    <section className="platformPage builderPage cleanBuilderPage">
      <section className="builderHeroPrompt">
        <div>
          <p className="eyebrow">AgentDock Orchestration Agent</p>
          <h1>Build a Flow</h1>
          <p>Describe the job. AgentDock picks agents, tools, memory, and approvals.</p>
        </div>
        <label className="promptLabel" htmlFor="flow-goal">What should this Flow do?</label>
        <textarea
          id="flow-goal"
          aria-label="Flow goal"
          placeholder="Find jobs, research companies, tailor resumes, and draft outreach. Do not send or apply without me."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
        />
        <div className="heroActions">
          <button className="primaryButton localPreviewButton" onClick={() => generateWorkflowDraft("goal")}>Generate Flow</button>
          <button className="secondaryButton localPreviewButton" onClick={() => generateWorkflowDraft("template")}>Load Template</button>
        </div>
        <div className="templateChipRow">
          {["Job Search Automation", "Research Brief", "Coding Review", "Sales Outreach"].map((template) => (
            <button
              className="templateChip"
              key={template}
              onClick={() => generateWorkflowDraft("template")}
            >
              {template}
            </button>
          ))}
        </div>
      </section>
      <div className="truthNotice">
        <CapabilityBadge kind={builderMode === "saved" || builderMode === "approval_pending" ? "db" : session?.user ? "local" : "mock"} />
        <strong>{modeLabels[builderMode]}</strong>
        <span>{builderNotice}</span>
      </div>

      {saved && (
        <div className="builderToast">
          <strong>Flow saved locally.</strong>
          <span>Mock access, memory, and run state updated for the demo.</span>
        </div>
      )}
      {saveMessage && (
        <div className="builderToast">
          <strong>{saveMessage.includes("saved") ? "Saved" : "Save Flow"}</strong>
          <span>{saveMessage}</span>
        </div>
      )}
      {runtimeMessage && (
        <div className="builderToast">
          <strong>{session?.user ? "Runtime" : "Demo mode"}</strong>
          <span>{runtimeMessage}</span>
        </div>
      )}

      {(builderMode === "saved" || builderMode === "running" || builderMode === "approval_pending") && (
        <div className="builderLibraryStrip">
          <div>
            <span>My Flows</span>
            <strong>{currentWorkflow?.name ?? "Job Search Automation"}</strong>
            <p>{currentWorkflow ? `${currentWorkflow.workflowAgents.length} agents - ${currentWorkflow.workflowMcps?.length ?? 0} tools - saved` : "Saved Flow ready"}</p>
          </div>
          <CapabilityBadge kind="db" />
        </div>
      )}

      <div className={hasDraftWorkflow ? "workflowPlannerLayout" : "workflowPlannerLayout emptyPlannerLayout"}>
        <section className="workflowTimelinePanel">
          <div className="panelHeader">
            <span>Generated Flow</span>
            <strong>{hasDraftWorkflow ? modeLabels[builderMode] : "No Flow yet"}</strong>
          </div>
          {!hasDraftWorkflow && (
            <div className="emptyWorkflowState">
              <strong>No Flow yet.</strong>
              <p>Describe the job or load a template to create a draft.</p>
            </div>
          )}
          <div className="verticalWorkflow">
            {visibleNodes.map((node, index) => {
              const details = workflowStepDetails[node.name] ?? {
                purpose: node.approvalMode,
                uses: node.attachments?.join(", ") || "Workflow context",
                allowed: node.permissions,
                blocked: node.type === "mcp" ? "Execution disabled" : "Broad access",
                status: node.type === "mcp" ? "Metadata only" : "Preview"
              };

              return (
                <button
                  className={activeSelectedNode?.id === node.id ? "workflowStepCard selected" : "workflowStepCard"}
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span className="stepNumber">{String(index + 1).padStart(2, "0")}</span>
                  <div className="stepMain">
                    <div className="stepTitleRow">
                      <div>
                        <strong>{stepDisplayNames[node.name] ?? node.name}</strong>
                        <span>{node.type === "control" ? "approval" : node.type === "mcp" ? "tool" : node.type}</span>
                      </div>
                      <b className="statusPill running">{details.status}</b>
                    </div>
                    <p>{details.purpose}</p>
                    <div className="stepDetailsGrid">
                      <DetailBlock label="Tools" value={details.uses} />
                      <DetailBlock label="Access" value={details.allowed} />
                      <DetailBlock label="Blocks" value={details.blocked} />
                    </div>
                    {attachedMcpNames.has(node.name) && <CapabilityBadge kind="db" label="DB-backed tool" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {hasDraftWorkflow && (
        <aside className="workflowInspectorPanel">
          <div className="panelHeader"><span>Step details</span><strong>{activeSelectedNode?.type ?? "None"}</strong></div>
          {activeSelectedNode ? (
            <>
              <h3>{stepDisplayNames[activeSelectedNode.name] ?? activeSelectedNode.name}</h3>
              <p>{selectedStepDetails.purpose}</p>
              <div className="inspectorGrid cleanInspectorGrid">
                <DetailBlock label="Type" value={activeSelectedNode.type === "control" ? "approval" : activeSelectedNode.type === "mcp" ? "tool" : activeSelectedNode.type} />
                <DetailBlock label="Provider/category" value={activeSelectedNode.provider ?? activeSelectedNode.category ?? "Control"} />
                <DetailBlock label="Trust/risk" value={activeSelectedNode.trustScore ? `${activeSelectedNode.trustScore}` : activeSelectedNode.riskLevel ?? "Low"} />
                <DetailBlock label="Memory" value={activeSelectedNode.memoryAccess} />
                <DetailBlock label="Tools" value={selectedStepDetails.uses} />
                <DetailBlock label="Runtime" value="AgentDock Sandbox Mode" />
                <DetailBlock label="Cost" value={activeSelectedNode.budgetImpact} />
                <DetailBlock label="Approvals" value={activeSelectedNode.approvalMode} />
              </div>
              {activeSelectedNode.type === "mcp" && selectedMcpGrant && (
                <div className="policyDiffList mcpGrantInspector">
                  <span>Tool Access</span>
                  {([
                    ["canRead", "can read"],
                    ["canWrite", "can write"],
                    ["canExecute", "can execute"],
                    ["canDelete", "can delete"],
                    ["requiresApproval", "requires approval"]
                  ] as const).map(([field, label]) => (
                    <button className={selectedMcpGrant[field] ? "grantToggle active" : "grantToggle"} key={field} onClick={() => updateMcpGrant(selectedMcpGrant, field)}>
                      {label}: {selectedMcpGrant[field] ? "on" : "off"}
                    </button>
                  ))}
                  <p>Allowed: {(selectedMcpGrant.allowedActions ?? []).join(", ") || "none"}</p>
                  <p>Blocked: {(selectedMcpGrant.blockedActions ?? []).join(", ") || "none"}</p>
                  <div className="buttonPair">
                    <button className="secondaryButton smallButton" onClick={() => updateMcpGrant(selectedMcpGrant, "requiresApproval")}>Edit Access</button>
                    <button className="revokeButton" onClick={() => revokeMcpGrant(selectedMcpGrant)}>Revoke Tool</button>
                    <button className="secondaryButton smallButton" onClick={onViewLogs}>View Timeline</button>
                  </div>
                </div>
              )}
              <div className="policyDiffList">
                <span>Access Plan</span>
                {policyDiffs.map((item) => <p key={item}>{item}</p>)}
              </div>
              <div className="buttonPair inspectorActions">
                <ComingSoonButton>Edit Access</ComingSoonButton>
                {activeSelectedNode.type === "agent" && <ComingSoonButton>Set as default</ComingSoonButton>}
                <button className="revokeButton localPreviewButton" onClick={() => onRemoveNode(activeSelectedNode.id)}>Remove</button>
              </div>
            </>
          ) : (
            <p>Select a step to inspect access, memory, tools, and budget.</p>
          )}
        </aside>
        )}
      </div>

      {hasDraftWorkflow && (
      <div className="builderLowerGrid">
      <section className="policySafetyPanel">
        <div className="panelHeader">
          <span>Policy & Safety</span>
          <strong>0 critical risks</strong>
        </div>
        <div className="policyCheckGrid compactPolicyChecks">
          {validationChecks.map((check) => <span key={check}>{check}</span>)}
        </div>
        {unsafeSimulation && (
          <div className="unsafeSimulationResult">
            <strong>Outreach Draft Agent attempts to send email</strong>
            <span>{"Blocked by Policy Engine -> approval required -> added to Inbox."}</span>
          </div>
        )}
      </section>

      <section className="plannerCard mcpBuilderPalette compactMcpAttachPanel">
        <div className="panelHeader">
          <span>Tools</span>
          <strong>{mcpServers.length ? "DB-backed catalog" : "Mock catalog fallback"}</strong>
        </div>
        <p>Add tool metadata to this Flow. Execution stays off for now.</p>
        <div className="mcpPaletteGrid">
          {(mcpServers.length ? mcpServers : mcpTools.map((tool) => ({
            id: tool.name,
            name: tool.name.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-"),
            displayName: tool.name,
            description: tool.scopes,
            registrySource: "mock",
            verified: tool.verified === "Verified",
            riskLevel: tool.risk.toLowerCase() as McpRiskLevel,
            category: tool.workflows,
            metadata: { recommendedPermission: tool.permission.toLowerCase().replaceAll(" ", "_") as McpDefaultPermission },
            tools: []
          }))).slice(0, 6).map((server) => (
            <article className="mcpPaletteItem" key={server.id}>
              <strong>{server.displayName}</strong>
              <span>{server.riskLevel} risk - {(server.metadata?.recommendedPermission ?? "approval_required").replaceAll("_", " ")}</span>
              <div className="buttonPair">
                <button className="secondaryButton smallButton localPreviewButton" onClick={() => addMcpVisualNode(server)}>Add to canvas</button>
                <button className="secondaryButton smallButton" disabled={attachingMcpId === server.id || !mcpServers.length} onClick={() => attachBuilderMcp(server)}>
                  {attachingMcpId === server.id ? "Adding..." : "Add Tool"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      </div>
      )}

      {hasDraftWorkflow && (
      <div className="simulationPanel">
        <div className="panelHeader">
          <span>Actions</span>
          <strong>{session?.user ? "DB-backed runs enabled" : "Flow valid with 2 approval gates and 0 critical risks."}</strong>
        </div>
        {session?.user && (
          <div className="runtimeSummary">
            <Metric label="Saved Flow" value={savedJobSearchWorkflow ? savedJobSearchWorkflow.name : "Save required"} />
            <Metric label="Runs" value={`${workflowRuns.length}`} />
            <Metric label="Approvals" value={`${dbApprovals.length}`} />
          </div>
        )}
        <div className="builderActionBar">
          <button className="primaryButton" onClick={saveWorkflowToProfile} disabled={savingWorkflow || !hasDraftWorkflow}>
            {savingWorkflow ? "Saving..." : "Save Flow"}
          </button>
          <button className="secondaryButton" onClick={() => simulateDatabaseRun("run")} disabled={runningSimulation || builderMode === "draft"}>
            {runningSimulation ? "Running..." : "Run Preview"}
          </button>
          <button className="secondaryButton localPreviewButton" onClick={editSavedWorkflow}>Edit Flow</button>
          <button className="secondaryButton localPreviewButton" onClick={simulateUnsafeAction}>Test Block</button>
          <button className="secondaryButton" onClick={onViewLogs}>View Timeline</button>
        </div>
        {builderMode === "draft" && <div className="softNote">Save Flow to run a DB preview.</div>}
      </div>
      )}

      {builderMode === "approval_pending" && (
        <div className="plannerSupportGrid">
          <ApprovalInbox
            items={approvalItems}
            approvals={dbApprovals}
            onResolve={resolveApproval}
            resolvingApprovalId={resolvingApprovalId}
            dbBacked={Boolean(session?.user && dbApprovals.length)}
          />
          <Card title="Recent Timeline" meta={session?.user ? "DB-backed" : "Local demo"}>
            {(workflowRuns[0]?.events?.length ? workflowRuns[0].events.map((event) => event.title) : builderSimulateEvents.map((event) => event.event)).slice(0, 6).map((event) => (
              <div className="approvalItem" key={event}>{event}</div>
            ))}
          </Card>
        </div>
      )}
    </section>
  );
}

function MemoryFirewallVisualizer({ selectedNode }: { selectedNode?: BuilderNode }) {
  const { data: session } = useSession();
  const [dbPartitions, setDbPartitions] = useState<PersistedMemoryPartition[]>([]);
  const accessByNode: Record<string, string[]> = {
    "Job Discovery Agent": ["Global Profile", "Job Search Memory"],
    "Company Research Agent": ["Job Search Memory", "Research Memory"],
    "Resume Tailoring Agent": ["Job Search Memory", "Resume Memory"],
    "Outreach Draft Agent": ["Job Search Memory"],
    "A2UI Approval Gate": ["Global Profile", "Job Search Memory", "Resume Memory", "Research Memory"]
  };

  useEffect(() => {
    if (!session?.user) {
      setDbPartitions([]);
      return;
    }

    const loadMemoryPolicy = async () => {
      try {
        const response = await fetch("/api/memory");
        const data = await response.json();

        if (response.ok) {
          setDbPartitions(data.partitions ?? []);
        }
      } catch {
        setDbPartitions([]);
      }
    };

    loadMemoryPolicy();
  }, [session?.user?.email]);

  const allowedForSelected = accessByNode[selectedNode?.name ?? ""] ?? [];
  const zones = dbPartitions.length
    ? dbPartitions.map((partition) => {
        const matchingGrant = partition.accessGrants.find((grant) => grant.agent?.name === selectedNode?.name);
        const canAccess = Boolean(matchingGrant && (matchingGrant.canRead || matchingGrant.canWrite || matchingGrant.canEdit || matchingGrant.canShare));
        return {
          name: partition.name,
          status: canAccess ? "allowed" : partition.defaultAccessPolicy === "blocked_by_default" ? "blocked" : partition.defaultAccessPolicy.replaceAll("_", " "),
          selectedAccess: canAccess
        };
      })
    : [
        { name: "Global Profile", status: "limited", selectedAccess: false },
        { name: "Job Search Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Job Search Memory") },
        { name: "Resume Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Resume Memory") },
        { name: "Research Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Research Memory") },
        { name: "Finance Memory", status: "blocked", selectedAccess: false },
        { name: "Health Memory", status: "blocked", selectedAccess: false },
        { name: "Travel Memory", status: "approval required", selectedAccess: false }
      ];

  return (
    <section className="plannerCard memoryVisualizer">
      <div className="panelHeader"><span>Memory Firewall Visualizer</span><strong>{dbPartitions.length ? "DB-backed grants" : selectedNode?.name ?? "Select a node"}</strong></div>
      <p>AgentDock partitions memory by workflow, sensitivity, and permission so each agent only receives the context it needs.</p>
      <div className="memoryZoneGrid">
        {zones.map((zone) => {
          return (
            <div className={`memoryZone ${zone.status.replaceAll(" ", "-")} ${zone.selectedAccess ? "selectedAccess" : ""}`} key={zone.name}>
              <strong>{zone.name}</strong>
              <span>{zone.selectedAccess ? "selected agent can access" : zone.status}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ApprovalInbox({
  items,
  approvals = [],
  onResolve,
  resolvingApprovalId = "",
  dbBacked = false
}: {
  items: string[];
  approvals?: PersistedApprovalRequest[];
  onResolve?: (approvalId: string, status: "approved" | "denied" | "edited") => void;
  resolvingApprovalId?: string;
  dbBacked?: boolean;
}) {
  const visibleApprovals = dbBacked ? approvals : [];

  return (
    <section className="plannerCard approvalInbox">
      <div className="panelHeader">
        <span>Approval Inbox</span>
        <strong>{dbBacked ? `${visibleApprovals.length} DB-backed pending` : `${items.length} pending`}</strong>
      </div>
      <div className="approvalInboxList">
        {visibleApprovals.map((approval) => (
          <article className="approvalInboxCard dbApproval" key={approval.id}>
            <strong>{approval.title}</strong>
            <span>{approval.agent?.name ?? "AgentDock"} - {approval.riskLevel} risk - persisted in Postgres</span>
            <p>{approval.description}</p>
            <div className="approvalActions">
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "approved")}>Approve</button>
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "denied")}>Deny</button>
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "edited")}>Edit policy</button>
            </div>
          </article>
        ))}
        {!dbBacked && items.map((item) => (
          <article className="approvalInboxCard" key={item}>
            <strong>{item}</strong>
            <span>{item.includes("blocked") ? "Blocked action" : "A2UI approval required"}</span>
            <div className="approvalActions">
              <ComingSoonButton>Approve</ComingSoonButton>
              <ComingSoonButton>Deny</ComingSoonButton>
              <ComingSoonButton>Edit policy</ComingSoonButton>
            </div>
          </article>
        ))}
        {dbBacked && visibleApprovals.length === 0 && (
          <article className="approvalInboxCard">
            <strong>No pending DB approvals</strong>
            <span>Run a database-backed simulation to create approval requests.</span>
          </article>
        )}
      </div>
    </section>
  );
}

function Store({
  tab,
  setTab,
  defaultAgent,
  setDefaultAgent
}: {
  tab: StoreTab;
  setTab: (tab: StoreTab) => void;
  defaultAgent: string;
  setDefaultAgent: (agent: string) => void;
}) {
  const { data: session } = useSession();
  const [mcpServers, setMcpServers] = useState<PersistedMcpServer[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [mcpMessage, setMcpMessage] = useState("");
  const [syncingMcp, setSyncingMcp] = useState(false);
  const [attachingMcpId, setAttachingMcpId] = useState("");

  const loadMcpServers = async () => {
    if (!session?.user) {
      setMcpServers([]);
      return;
    }

    try {
      const response = await fetch("/api/mcp/servers");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load MCP catalog.");
      }

      setMcpServers(data.servers ?? []);
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Unable to load MCP catalog. Showing mock fallback.");
      setMcpServers([]);
    }
  };

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    try {
      const response = await fetch("/api/workflows");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load saved Flows.");
      }

      setSavedWorkflows(data.workflows ?? []);
    } catch {
      setSavedWorkflows([]);
    }
  };

  useEffect(() => {
    if (tab === "Tools") {
      loadMcpServers();
      loadSavedWorkflows();
    }
  }, [tab, session?.user?.email]);

  const syncMcpRegistry = async () => {
    if (!session?.user) {
      setMcpMessage("Sign in with Google to sync tool metadata into AgentDock.");
      return;
    }

    setSyncingMcp(true);
    setMcpMessage("");

    try {
      const response = await fetch("/api/mcp/sync-registry", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Tool sync failed.");
      }

      setMcpMessage(`Tools synced. Imported or updated ${data.imported} records.`);
      await loadMcpServers();
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Tool sync failed.");
    } finally {
      setSyncingMcp(false);
    }
  };

  const attachMcpToWorkflow = async (server: PersistedMcpServer) => {
    if (!session?.user) {
      setMcpMessage("Sign in with Google to add tools to a saved Flow.");
      return;
    }

    const workflow = savedWorkflows.find((item) => item.name === "Job Search Automation") ?? savedWorkflows[0];

    if (!workflow?.id) {
      setMcpMessage("Save Job Search Automation first, then add tools to the Flow.");
      return;
    }

    const defaultPermission = server.metadata?.recommendedPermission ?? (server.riskLevel === "low" ? "read_only" : server.riskLevel === "high" ? "draft_only" : server.riskLevel === "restricted" ? "blocked" : "approval_required");
    setAttachingMcpId(server.id);
    setMcpMessage("");

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/mcps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcpServerId: server.id,
          purpose: `${server.displayName} scoped to ${workflow.name}`,
          defaultPermission
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to add tool to Flow.");
      }

      setMcpMessage(`${server.displayName} added to ${workflow.name} with ${defaultPermission.replaceAll("_", " ")} access.`);
      await loadSavedWorkflows();
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Unable to add tool to Flow.");
    } finally {
      setAttachingMcpId("");
    }
  };

  const dbMcpAvailable = Boolean(session?.user && mcpServers.length);

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Store" title="Store" copy="Agents, tools, and templates you can add to Flows." />
      <div className="truthNotice">
        <CapabilityBadge kind={session?.user ? "db" : "mock"} />
        <strong>{session?.user ? "DB-backed mode active." : "You are in demo mode. Sign in to persist Flows, runs, approvals, memory, and tools."}</strong>
        <span>Agent and template installs are previews. Tools can be added to saved Flows.</span>
      </div>
      <div className="tabRow">
        {(["Agents", "Tools", "Templates"] as StoreTab[]).map((item) => (
          <button className={tab === item ? "tabButton active" : "tabButton"} key={item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === "Agents" && (
        <div className="agentGrid compactStoreGrid">
          {agents.map((agent, index) => (
            <article className="agentCard compactAgentCard" key={agent.name}>
              <div className="agentTopline">
                <div className="badgeGroup">
                  <span className="rankText">#{index + 1} {agent.category}</span>
                  {agent.verified && <span className="verifiedBadge">Verified</span>}
                </div>
                <div className="buttonPair">
                  <ComingSoonButton>Install</ComingSoonButton>
                  <ComingSoonButton>{defaultAgent === agent.name ? "Default" : "Set default"}</ComingSoonButton>
                </div>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.description}</p>
              <div className="agentStats compactStats">
                <Metric label="Provider" value={agent.provider} />
                <Metric label="Trust" value={`${agent.trustScore}`} />
                <Metric label="Cost/task" value={agent.costPerTask} />
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "Tools" && (
        <>
          <div className="mcpStoreIntro">
            <p>Listed does not mean trusted. AgentDock adds risk, access, Flow scope, logs, and revocation first.</p>
            <div className="buttonPair">
              <button className="primaryButton" onClick={syncMcpRegistry} disabled={syncingMcp}>
                {syncingMcp ? "Syncing..." : "Sync Tools"}
              </button>
              <CapabilityBadge kind={session?.user ? "db" : "mock"} />
            </div>
          </div>
          {mcpMessage && <div className="profileAuthNotice">{mcpMessage}</div>}
          {!session?.user && <div className="profileAuthNotice">Signed-out demo mode: showing mock tool cards. Sign in to sync the tool catalog.</div>}
          <div className="mcpGrid compactStoreGrid">
            {dbMcpAvailable ? mcpServers.map((server) => {
              const defaultPermission = server.metadata?.recommendedPermission ?? (server.riskLevel === "low" ? "read_only" : server.riskLevel === "high" ? "draft_only" : server.riskLevel === "restricted" ? "blocked" : "approval_required");
              return (
                <article className="mcpCard compactAgentCard" key={server.id}>
                  <div className="panelHeader">
                    <span>{server.registrySource}</span>
                    <strong>{server.riskLevel} risk</strong>
                  </div>
                  <div className="badgeGroup">
                    {server.verified && <span className="verifiedBadge">Verified</span>}
                    <span className="rankText">{server.category ?? "Uncategorized"}</span>
                  </div>
                  <h3>{server.displayName}</h3>
                  <p>{server.description}</p>
                  <Metric label="Access" value={defaultPermission.replaceAll("_", " ")} />
                  <Metric label="Tools" value={`${server.tools?.length ?? 0} metadata records`} />
                  <div className="buttonPair">
                    <button className="secondaryButton smallButton" disabled={attachingMcpId === server.id} onClick={() => attachMcpToWorkflow(server)}>
                      {attachingMcpId === server.id ? "Adding..." : "Add Tool"}
                    </button>
                    <button className="secondaryButton smallButton localPreviewButton" onClick={() => setMcpMessage(`${server.displayName}: ${server.description} Source: ${server.registrySource}. Execution is off.`)}>Preview details</button>
                  </div>
                </article>
              );
            }) : mcpTools.map((tool) => (
              <article className="mcpCard compactAgentCard" key={tool.name}>
                <div className="panelHeader">
                  <span>{tool.verified}</span>
                  <strong>{tool.risk} risk</strong>
                </div>
                <h3>{tool.name}</h3>
                <p>{tool.scopes}</p>
                <Metric label="Access" value={tool.permission} />
                <Metric label="Works with" value={tool.workflows} />
                <div className="buttonPair">
                  <ComingSoonButton>Add Tool</ComingSoonButton>
                  <button className="secondaryButton smallButton localPreviewButton" onClick={() => setMcpMessage(`${tool.name}: mock metadata preview. Sign in to sync DB-backed details.`)}>Preview details</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "Templates" && (
        <div className="templateGrid">
          {workflowTemplates.map((workflow) => (
            <WorkflowTemplateCard workflow={workflow} key={workflow.name} />
          ))}
        </div>
      )}
    </section>
  );
}

function Library({ tab, setTab, spend }: { tab: LibraryTab; setTab: (tab: LibraryTab) => void; spend: number }) {
  const { data: session } = useSession();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [loadingSavedWorkflows, setLoadingSavedWorkflows] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [updatingMcpGrantId, setUpdatingMcpGrantId] = useState("");

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    setLoadingSavedWorkflows(true);
    setWorkflowMessage("");

    try {
      const response = await fetch("/api/workflows");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load saved Flows.");
      }

      setSavedWorkflows(data.workflows ?? []);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to load saved Flows.");
    } finally {
      setLoadingSavedWorkflows(false);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
  }, [session?.user?.email]);

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      setWorkflowMessage("Sign in with Google to save Flows to your AgentDock profile.");
      return;
    }

    setSavingWorkflow(true);
    setWorkflowMessage("");

    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobSearchWorkflowPayload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Flow save failed.");
      }

      setWorkflowMessage("Flow saved to your AgentDock profile.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Flow save failed.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  const visibleWorkflows = session?.user ? savedWorkflows : [];
  const selectedWorkflow = visibleWorkflows.find((workflow) => workflow.name === "Job Search Automation") ?? visibleWorkflows[0];
  const installedAgents = visibleWorkflows.flatMap((workflow) => workflow.workflowAgents.map((workflowAgent) => workflowAgent.agent));
  const attachedMcps = visibleWorkflows.flatMap((workflow) => workflow.workflowMcps ?? []);

  const updateWorkflowMcpGrant = async (grant: PersistedMcpAccessGrant, field: "canRead" | "canWrite" | "canExecute" | "canDelete" | "requiresApproval") => {
    setUpdatingMcpGrantId(grant.id);
    setWorkflowMessage("");

    try {
      const response = await fetch(`/api/mcp/grants/${grant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !grant[field] })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to update tool access.");
      }

      setWorkflowMessage("Tool access updated and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to update tool access.");
    } finally {
      setUpdatingMcpGrantId("");
    }
  };

  const revokeWorkflowMcpGrant = async (grant: PersistedMcpAccessGrant) => {
    setUpdatingMcpGrantId(grant.id);
    setWorkflowMessage("");

    try {
      const response = await fetch(`/api/mcp/grants/${grant.id}/revoke`, { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to revoke tool.");
      }

      setWorkflowMessage("Tool revoked and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to revoke tool.");
    } finally {
      setUpdatingMcpGrantId("");
    }
  };

  return (
    <section className="platformPage libraryPage">
      <PageHeader eyebrow="Flows" title="Flows" copy="Saved agent systems you can run, edit, or pause." />
      <div className="truthNotice">
        <CapabilityBadge kind={session?.user ? "db" : "mock"} />
        <strong>{session?.user ? "DB-backed mode active." : "You are in demo mode."}</strong>
        <span>Saved Flows and tool access load from Postgres when signed in. Scoped Access is a preview.</span>
      </div>
      {workflowMessage && <div className="profileAuthNotice">{workflowMessage}</div>}
      <div className="tabRow">
        {(["My Flows", "My Agents", "My Tools", "Scoped Access"] as LibraryTab[]).map((item) => (
          <button className={tab === item ? "tabButton active" : "tabButton"} key={item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>

      {tab === "My Flows" && (
        <div className="libraryGrid">
          <Card title="My Flows" meta={session?.user ? `${visibleWorkflows.length} saved` : "Demo"}>
            {loadingSavedWorkflows && <div className="savedWorkflow"><strong>Loading Flows...</strong><span>Postgres profile</span></div>}
            {!session?.user && <div className="profileAuthNotice compactNotice">Sign in to save Flows. Mock drafts remain available in Build.</div>}
            {session?.user && !loadingSavedWorkflows && visibleWorkflows.length === 0 && (
              <div className="savedWorkflow">
                <strong>No Flows yet.</strong>
                <span>Save a Flow from Build to begin.</span>
              </div>
            )}
            {visibleWorkflows.map((workflow) => (
              <div className="savedWorkflow" key={workflow.id}>
                <strong>{workflow.name}</strong>
                <span>{workflow.status} - {workflow.workflowAgents.length} agents - {workflow.workflowMcps?.length ?? 0} tools</span>
              </div>
            ))}
            <div className="heroActions compactActions">
              <button className="secondaryButton" onClick={saveWorkflowToProfile} disabled={savingWorkflow}>
                {savingWorkflow ? "Saving..." : "Save Job Search"}
              </button>
            </div>
          </Card>
          <Card title="Flow detail" meta={selectedWorkflow?.name ?? "Template"}>
            <div className="detailGrid">
              <DetailBlock label="Goal" value={selectedWorkflow?.goal ?? "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval."} />
              <DetailBlock label="Agents" value={selectedWorkflow?.workflowAgents?.map((workflowAgent) => workflowAgent.agent.name).join(" -> ") || "Discovery -> Research -> Resume -> Outreach"} />
              <DetailBlock label="Tools" value={selectedWorkflow?.workflowMcps?.length ? selectedWorkflow.workflowMcps.map((mcp) => mcp.mcpServer.displayName).join(", ") : "No DB-backed tools yet"} />
              <DetailBlock label="Budget" value={`${formatCents(selectedWorkflow?.weeklyBudgetCents ?? 500)} weekly cap`} />
              <DetailBlock label="Runtime mode" value="AgentDock Sandbox Mode" />
            </div>
          </Card>
        </div>
      )}

      {tab === "My Agents" && (
        <div className="agentGrid compactStoreGrid">
          {(session?.user && installedAgents.length ? installedAgents : workflowAgents).map((agent) => (
            <article className="agentCard compactAgentCard" key={agent.name}>
              <div className="agentTopline">
                <span className="verifiedBadge">Used in Flow</span>
                <CapabilityBadge kind={session?.user ? "db" : "mock"} />
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.provider} - {agent.category}</p>
            </article>
          ))}
        </div>
      )}

      {tab === "My Tools" && (
        <div className="libraryGrid">
          <Card title="Tools" meta={`${attachedMcps.length} scoped`}>
            {attachedMcps.length ? attachedMcps.map((workflowMcp) => {
                const grant = selectedWorkflow?.mcpAccessGrants?.find((item) => item.mcpServer.id === workflowMcp.mcpServer.id);
                return (
                  <div className="mcpWorkflowAttachment" key={workflowMcp.id}>
                    <div>
                      <strong>{workflowMcp.mcpServer.displayName}</strong>
                      <span>{workflowMcp.purpose ?? "Flow-scoped tool metadata"}</span>
                    </div>
                    <span>{workflowMcp.defaultPermission.replaceAll("_", " ")} - {workflowMcp.mcpServer.riskLevel} risk - {grant?.requiresApproval ? "approval required" : "no approval"}</span>
                    {grant && (
                      <>
                        <div className="grantToggleGrid">
                          {([
                            ["canRead", "read"],
                            ["canWrite", "write"],
                            ["canExecute", "execute"],
                            ["canDelete", "delete"],
                            ["requiresApproval", "approval"]
                          ] as const).map(([field, label]) => (
                            <button className={grant[field] ? "grantToggle active" : "grantToggle"} disabled={updatingMcpGrantId === grant.id} key={field} onClick={() => updateWorkflowMcpGrant(grant, field)}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="buttonPair">
                          <button className="secondaryButton smallButton" disabled={updatingMcpGrantId === grant.id} onClick={() => updateWorkflowMcpGrant(grant, "requiresApproval")}>Edit Access</button>
                          <button className="revokeButton" disabled={updatingMcpGrantId === grant.id} onClick={() => revokeWorkflowMcpGrant(grant)}>Revoke Tool</button>
                        </div>
                      </>
                    )}
                  </div>
                );
              }) : <div className="approvalItem">No DB-backed tools yet. Add one from Store or Build.</div>}
          </Card>
        </div>
      )}

      {tab === "Scoped Access" && (
        <div className="libraryGrid">
          <KeysBilling spend={spend} />
        </div>
      )}
    </section>
  );
}

function Profile({
  selectedMemory,
  onSelectMemory,
  defaultAgent
}: {
  selectedMemory: string;
  onSelectMemory: (name: string) => void;
  defaultAgent: string;
}) {
  const { data: session } = useSession();
  const profileName = session?.user?.name ?? "Shubham Joshi";
  const profileEmail = session?.user?.email ?? "shubham@example.com";

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Profile" title="Profile" copy="Defaults for access, memory, models, and spend." />
      {session?.user ? (
        <div className="profileAuthNotice">Signed in as {profileName || profileEmail}</div>
      ) : (
        <div className="profileAuthNotice">Sign in to save Flows, Memory Zones, Scoped Access, and Timeline.</div>
      )}
      <div className="profileGrid">
        <Card title="Identity basics" meta="User">
          <DetailBlock label="Name" value={profileName ?? "Not signed in"} />
          <DetailBlock label="Email" value={profileEmail ?? "Not signed in"} />
          <DetailBlock label="Workspace" value="Personal demo workspace" />
        </Card>
        <Card title="Approval defaults" meta="High trust">
          {["Email sends require approval", "Payments are blocked by default", "External sharing requires approval", "Restricted memory always approval-gated"].map((rule) => <div className="approvalItem" key={rule}>{rule}</div>)}
        </Card>
        <Card title="Default agents" meta={defaultAgent}>
          <DetailBlock label="Discovery" value="Job Discovery Agent" />
          <DetailBlock label="Research" value="Company Research Agent" />
          <DetailBlock label="Documents" value="Resume Tailoring Agent" />
        </Card>
        <Card title="Model defaults" meta="Cross-model">
          <DetailBlock label="Default provider" value="OpenAI for Flow planning" />
          <DetailBlock label="Research provider" value="Claude" />
          <DetailBlock label="Outreach provider" value="Gemini" />
        </Card>
        <Card title="Budget defaults" meta="$5/week">
          <DetailBlock label="Weekly cap" value="$5.00" />
          <DetailBlock label="Max run budget" value="$1.50" />
          <DetailBlock label="Premium model policy" value="Allowed within cap" />
        </Card>
        <Card title="Sharing" meta="Conservative">
          <DetailBlock label="Raw memory export" value="Blocked by default" />
          <DetailBlock label="Team sharing" value="Approval required" />
          <DetailBlock label="Third-party reuse" value="Blocked" />
        </Card>
      </div>
      <MemorySection selectedMemory={selectedMemory} onSelectMemory={onSelectMemory} />
    </section>
  );
}

function KeysBilling({ spend }: { spend: number }) {
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Access" title="Access Gateway" copy="Agents never receive raw keys. AgentDock issues scoped, revocable access." />
      <div className="truthNotice">
        <CapabilityBadge kind="soon" />
        <strong>Coming soon / metadata preview.</strong>
        <span>This page previews the Access Gateway. Real provider connections, billing, and credential minting are not active yet.</span>
      </div>
      <div className="providerGrid">
        {["OpenAI", "Anthropic", "Gemini", "OpenRouter", "Google Workspace", "GitHub", "Stripe later"].map((provider) => (
          <div className="providerCard" key={provider}>
            <strong>{provider}</strong>
            <span>{provider === "Stripe later" ? "Planned" : "Metadata preview"}</span>
          </div>
        ))}
      </div>
      <Card title="Scoped Access" meta="No raw keys exposed">
        <div className="tableWrap platformTable">
          <table>
            <thead><tr><th>Provider</th><th>Agent</th><th>Flow</th><th>Scope</th><th>Expiry</th><th>Status</th></tr></thead>
            <tbody>
              {credentials.map((credential) => (
                <tr key={`${credential.provider}-${credential.agent}`}>
                  <td>{credential.provider}</td><td>{credential.agent}</td><td>{credential.workflow}</td><td>{credential.scope}</td><td>{credential.expiry}</td><td>{credential.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="dashboardGrid">
        <Card title="Spend caps" meta="Policy enforced">
          <WorkflowMini name="Job Search Automation" status="Active" budget={`$${spend.toFixed(2)} / $5.00`} />
          <WorkflowMini name="Research Brief Generator" status="Ready" budget="$0.42 / $3.00" />
          <WorkflowMini name="Coding Review Stack" status="Paused" budget="$0.00 / $7.00" />
        </Card>
        <Card title="Provider usage breakdown" meta="Mock usage">
          {providerUsage.map((usage) => (
            <div className="compactItem" key={usage.provider}>
              <div><strong>{usage.provider}</strong><span>{usage.usage} used</span></div>
              <span>{usage.cap}</span>
            </div>
          ))}
        </Card>
      </div>
    </section>
  );
}

function Activity({ events }: { events: AuditEvent[] }) {
  const { data: session } = useSession();
  const [activityLogs, setActivityLogs] = useState<PersistedActivityLog[]>([]);
  const [activityMessage, setActivityMessage] = useState("");
  const [loadingActivity, setLoadingActivity] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setActivityLogs([]);
      return;
    }

    const loadActivity = async () => {
      setLoadingActivity(true);
      setActivityMessage("");

      try {
        const response = await fetch("/api/activity");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message ?? "Unable to load Timeline.");
        }

        setActivityLogs(data.activityLogs ?? []);
      } catch (error) {
        setActivityMessage(error instanceof Error ? error.message : "Unable to load Timeline. Showing mock fallback.");
      } finally {
        setLoadingActivity(false);
      }
    };

    loadActivity();
  }, [session?.user?.email]);

  const visibleEvents = session?.user && activityLogs.length
    ? activityLogs.map(activityLogToAuditEvent)
    : events;

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Timeline" title="Timeline" copy="Runs, approvals, memory, tools, spend, and blocks." />
      {session?.user ? (
        <div className="profileAuthNotice">
          {activityLogs.length ? `Showing ${activityLogs.length} DB-backed Timeline rows from Postgres.` : "No DB-backed Timeline yet. Run a preview to persist events."}
        </div>
      ) : (
        <div className="profileAuthNotice">Signed-out demo mode: showing mock Timeline. Sign in to persist runs.</div>
      )}
      {loadingActivity && <div className="profileAuthNotice">Loading DB-backed Timeline...</div>}
      {activityMessage && <div className="profileAuthNotice">{activityMessage}</div>}
      <div className="filterBar">
        {["type", "agent", "Flow", "tool", "access", "memory", "cost", "decision"].map((filter) => <span key={filter}>{filter}</span>)}
      </div>
      <div className="activityTimeline fullTimeline">
        {visibleEvents.map((event, index) => (
          <div className="auditRow" key={`${event.event}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{event.event}</strong>
              <p>{event.agent} - {event.workflow} - {event.tool}</p>
            </div>
            <Metric label="Permission" value={event.permission} />
            <Metric label="Type" value={event.type} />
            <Metric label="Memory" value={event.memory} />
            <Metric label="Cost" value={event.cost} />
            <b className={`decisionBadge ${event.decision}`}>{event.decision.replace("_", " ")}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function Architecture() {
  const stack = ["Control", "Orchestration Agent", "Policy Engine", "Memory Firewall + Access Gateway", "AgentDock Runtime / Sandbox", "Agent Router", "Agents", "Tool Gateway", "Tools / Models / Apps"];
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Architecture" title="A policy layer for agents, credentials, memory, runtimes, tools, and models." copy="A2A coordinates agents. MCP connects tools. A2UI keeps the user in control. AgentDock’s policy layer decides what is allowed. The Memory Firewall decides what context each agent can access." />
      <div className="architectureFlow polished">
        {stack.map((node, index) => (
          <div className="architectureNode" key={node}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{node}</strong>
          </div>
        ))}
      </div>
      <div className="architectureNotes">
        <Card title="A2A" meta="Agent coordination"><p>Routes handoffs across third-party agents while preserving approval gates and policy context.</p></Card>
        <Card title="MCP" meta="Tool access"><p>Connects external tools through scoped, revocable permissions rather than broad raw keys.</p></Card>
        <Card title="Runtime" meta="Sandbox selected"><p>AgentDock is not trying to be a raw GPU cloud. It manages where and how agent workflows run: provider APIs, AgentDock sandbox, user cloud, or local runtime.</p></Card>
        <Card title="A2UI" meta="User control"><p>Keeps approvals, memory, spend, credentials, and logs visible to the human operator.</p></Card>
      </div>
    </section>
  );
}

function MemorySection({ selectedMemory, onSelectMemory }: { selectedMemory: string; onSelectMemory: (name: string) => void }) {
  const { data: session } = useSession();
  const [memoryData, setMemoryData] = useState<PersistedMemoryPayload | null>(null);
  const [memoryMessage, setMemoryMessage] = useState("");
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [updatingGrantId, setUpdatingGrantId] = useState("");
  const activeMockPartition = memoryPartitions.find((partition) => partition.name === selectedMemory) ?? memoryPartitions[1];
  const activeDbPartition = memoryData?.partitions.find((partition) => partition.name === selectedMemory) ?? memoryData?.partitions[0];
  const dbBacked = Boolean(session?.user && memoryData?.partitions.length);

  const loadMemoryData = async () => {
    if (!session?.user) {
      setMemoryData(null);
      return;
    }

    setLoadingMemory(true);
    setMemoryMessage("");

    try {
      const response = await fetch("/api/memory");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to load memory policy.");
      }

      setMemoryData(data);
      if (data.partitions?.length && !data.partitions.some((partition: PersistedMemoryPartition) => partition.name === selectedMemory)) {
        onSelectMemory(data.partitions[0].name);
      }
      if (data.bootstrapped) {
        setMemoryMessage("Created starter DB-backed Memory Zones for this profile.");
      }
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : "Unable to load memory policy. Showing mock fallback.");
      setMemoryData(null);
    } finally {
      setLoadingMemory(false);
    }
  };

  useEffect(() => {
    loadMemoryData();
  }, [session?.user?.email]);

  const patchGrant = async (grant: PersistedMemoryGrant, field: keyof Pick<PersistedMemoryGrant, "canRead" | "canWrite" | "canEdit" | "canDelete" | "canShare" | "requiresApproval">) => {
    setUpdatingGrantId(grant.id);
    setMemoryMessage("");

    try {
      const response = await fetch(`/api/memory/grants/${grant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !grant[field] })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to update memory grant.");
      }

      setMemoryMessage("Memory access updated and logged.");
      await loadMemoryData();
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : "Unable to update memory grant.");
    } finally {
      setUpdatingGrantId("");
    }
  };

  const revokeGrant = async (grantId: string) => {
    setUpdatingGrantId(grantId);
    setMemoryMessage("");

    try {
      const response = await fetch(`/api/memory/grants/${grantId}/revoke`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to revoke memory grant.");
      }

      setMemoryMessage("Access revoked and written to Timeline.");
      await loadMemoryData();
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : "Unable to revoke memory grant.");
    } finally {
      setUpdatingGrantId("");
    }
  };

  return (
    <section className="memorySection">
      <div className="memoryFirewallCard">
        <div>
          <p className="eyebrow">Memory Firewall</p>
          <h3>Agents only receive the context they need.</h3>
          <p>AgentDock partitions memory by Flow, sensitivity, and access so agents only see what they need.</p>
        </div>
        <div className="dbStatus">
          <span>{dbBacked ? "DB-backed Memory Zones" : "Demo Memory Zones"}</span>
          <strong>{dbBacked ? `${memoryData?.partitions.length ?? 0} zones loaded from Postgres` : "Mock-backed UI"}</strong>
          <p>{dbBacked ? "Access, items, and memory logs are loaded for the signed-in user." : "Sign in to load zones, access, items, and logs from Postgres."}</p>
        </div>
      </div>
      {loadingMemory && <div className="profileAuthNotice">Loading Memory Zones from Postgres...</div>}
      {memoryMessage && <div className="profileAuthNotice">{memoryMessage}</div>}
      <div className="memoryLayout">
        <div className="card">
          <div className="panelHeader">
            <span>Memory Zones</span>
            <strong>{dbBacked ? `${memoryData?.partitions.length ?? 0} DB zones` : `${memoryPartitions.length} mock zones`}</strong>
          </div>
          <div className="memoryTable">
            {dbBacked && memoryData ? (
              memoryData.partitions.map((partition) => (
                <button className={`memoryRow ${partition.name === activeDbPartition?.name ? "selected" : ""}`} key={partition.id} onClick={() => onSelectMemory(partition.name)}>
                  <div><strong>{partition.name}</strong><span>{partition.description}</span></div>
                  <span className={`sensitivityBadge ${partition.sensitivityLevel}`}>{partition.sensitivityLevel}</span>
                  <span>{partition.workflow?.name ?? "Global / domain"}</span>
                  <span>{partition.defaultAccessPolicy.replaceAll("_", " ")}</span>
                  <span className="rowActions">{partition.accessGrants.length} grants</span>
                </button>
              ))
            ) : (
              memoryPartitions.map((partition) => (
                <button className={`memoryRow ${partition.name === activeMockPartition.name ? "selected" : ""}`} key={partition.name} onClick={() => onSelectMemory(partition.name)}>
                  <div><strong>{partition.name}</strong><span>{partition.description}</span></div>
                  <span className={`sensitivityBadge ${partition.sensitivity}`}>{partition.sensitivity}</span>
                  <span>{partition.access}</span>
                  <span>{partition.permissionLevel}</span>
                  <span className="rowActions">Edit / Revoke</span>
                </button>
              ))
            )}
          </div>
        </div>
        <aside className="card memoryDetail">
          <div className="panelHeader"><span>Zone detail</span><strong>{dbBacked ? activeDbPartition?.name : activeMockPartition.name}</strong></div>
          {dbBacked && activeDbPartition ? (
            <>
              <div className="detailStack">
                <DetailBlock label="Flow" value={activeDbPartition.workflow?.name ?? "Global / domain memory"} />
                <DetailBlock label="Sensitivity" value={activeDbPartition.sensitivityLevel} />
                <DetailBlock label="Default access" value={activeDbPartition.defaultAccessPolicy.replaceAll("_", " ")} />
              </div>
              <div className="permissionList">
                <span>Items</span>
                {activeDbPartition.memoryItems.length ? activeDbPartition.memoryItems.map((item) => (
                  <p key={item.id}><strong>{item.title}</strong><br />{item.content}</p>
                )) : <p>No memory items in this partition yet.</p>}
              </div>
              <div className="permissionList">
                <span>Access</span>
                {activeDbPartition.accessGrants.length ? activeDbPartition.accessGrants.map((grant) => (
                  <div className="grantEditor" key={grant.id}>
                    <div>
                      <strong>{grant.agent?.name ?? grant.workflow?.name ?? "Workflow grant"}</strong>
                      <span>{grant.workflow?.name ?? "No Flow scope"}</span>
                    </div>
                    <div className="grantToggleGrid">
                      {(["canRead", "canWrite", "canEdit", "canDelete", "canShare", "requiresApproval"] as const).map((field) => (
                        <button
                          className={grant[field] ? "grantToggle active" : "grantToggle"}
                          disabled={updatingGrantId === grant.id}
                          key={field}
                          onClick={() => patchGrant(grant, field)}
                        >
                          {field.replace("can", "").replace("requiresApproval", "approval")}
                        </button>
                      ))}
                    </div>
                    <button className="revokeButton" disabled={updatingGrantId === grant.id} onClick={() => revokeGrant(grant.id)}>
                      {updatingGrantId === grant.id ? "Updating..." : "Revoke Access"}
                    </button>
                  </div>
                )) : <p>No agents currently have direct grants to this partition.</p>}
              </div>
              <div className="permissionList">
                <span>Recent logs</span>
                {activeDbPartition.accessLogs.length ? activeDbPartition.accessLogs.map((log) => (
                  <p key={log.id}>{log.agent?.name ?? "AgentDock"} - {log.action} - {log.decision}: {log.reason}</p>
                )) : <p>No recent memory logs for this partition.</p>}
              </div>
            </>
          ) : (
            <>
              <div className="detailStack">
                <DetailBlock label="Flow" value={activeMockPartition.workflow} />
                <DetailBlock label="Allowed agents" value={activeMockPartition.allowedAgents.length ? activeMockPartition.allowedAgents.join(", ") : "None by default"} />
                <DetailBlock label="Blocked agents" value={activeMockPartition.blockedAgents.join(", ")} />
              </div>
              <div className="permissionList">
                <span>Access</span>
                {activeMockPartition.permissions.map((permission) => <p key={permission}>{permission}</p>)}
              </div>
              <div className="actionRow detailActions">
                <ComingSoonButton>Edit Access</ComingSoonButton>
                <ComingSoonButton className="revokeButton">Revoke Access</ComingSoonButton>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function PageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="sectionHeader pageHeader">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function Card({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="panelHeader"><span>{title}</span><strong>{meta}</strong></div>
      {children}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <span className="metric"><span>{label}</span><strong>{value}</strong></span>;
}

function CapabilityBadge({ kind, label }: { kind: CapabilityKind; label?: string }) {
  const labels: Record<CapabilityKind, string> = {
    db: "DB-backed",
    local: "Local preview",
    soon: "Coming soon",
    mock: "Mock fallback"
  };

  return <span className={`capabilityBadge ${kind}`}>{label ?? labels[kind]}</span>;
}

function ComingSoonButton({ children, className = "secondaryButton smallButton" }: { children: React.ReactNode; className?: string }) {
  return (
    <button className={`${className} comingSoonButton`} disabled>
      {children} · Coming soon
    </button>
  );
}

function WorkflowMini({ name, status, budget }: { name: string; status: string; budget: string }) {
  return (
    <div className="compactItem">
      <div><strong>{name}</strong><span>{budget}</span></div>
      <span className={status === "Active" ? "statusPill running" : "statusPill awaitingapproval"}>{status}</span>
    </div>
  );
}

function RouteView() {
  return (
    <div className="flowDiagram">
      {flow.map((item, index) => (
        <div className="flowNodeWrap" key={item}>
          <div className="flowNode"><span>{index + 1}</span><strong>{item}</strong></div>
          {index < flow.length - 1 && <div className="connector" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function AuditList({ events, compact = false }: { events: AuditEvent[]; compact?: boolean }) {
  return (
    <div className={compact ? "timeline compactTimeline" : "timeline"}>
      {events.map((event, index) => (
        <div className="timelineEvent" key={`${event.event}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{event.event}</p>
        </div>
      ))}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return <div className="detailBlock"><span>{label}</span><strong>{value}</strong></div>;
}

function RuntimeModeSection({ context }: { context: "builder" | "workflow" }) {
  return (
    <section className={context === "builder" ? "runtimeSection" : "runtimeSection compactRuntime"}>
      <div className="panelHeader">
        <span>Runtime Mode</span>
        <strong>AgentDock Sandbox Mode selected</strong>
      </div>
      <p className="runtimeCopy">
        AgentDock is not trying to be a raw GPU cloud. It manages where and how agent workflows run:
        provider APIs, AgentDock sandbox, user cloud, or local runtime.
      </p>
      <div className="runtimeGrid">
        {runtimeModes.map((mode) => (
          <article className={mode.name === "AgentDock Sandbox Mode" ? "runtimeCard selected" : "runtimeCard"} key={mode.name}>
            <div className="runtimeTopline">
              <strong>{mode.name}</strong>
              <span>{mode.status}</span>
            </div>
            <p>{mode.description}</p>
            <small>Best for {mode.bestFor}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function getBuilderPaletteItems(tab: BuilderPaletteTab): BuilderNode[] {
  if (tab === "Agents") {
    return agents.map((agent) => ({
      id: `palette-agent-${agent.name.toLowerCase().replaceAll(" ", "-")}`,
      name: agent.name,
      type: "agent",
      provider: agent.provider,
      category: agent.category,
      trustScore: agent.trustScore,
      permissions: agent.requiredAccess,
      memoryAccess: agent.requiredAccess.includes("Memory") ? agent.requiredAccess : "Workflow-scoped only",
      budgetImpact: `${agent.costPerTask}/task`,
      approvalMode: agent.defaultMode,
      attachments: agent.name === "Job Discovery Agent" ? ["Search MCP", "Job Search Memory"] : agent.name === "Company Research Agent" ? ["Search MCP", "Research Memory"] : agent.name === "Resume Tailoring Agent" ? ["Docs / Notion MCP", "Resume Memory"] : agent.name === "Outreach Draft Agent" ? ["Gmail Draft MCP", "Job Search Memory"] : []
    }));
  }

  if (tab === "Tools") {
    return mcpTools.map((tool) => ({
      id: `palette-mcp-${tool.name.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`,
      name: tool.name === "Gmail draft-only MCP" ? "Gmail Draft MCP" : tool.name,
      type: "mcp",
      category: "Tool",
      riskLevel: tool.risk,
      permissions: tool.permission,
      memoryAccess: "No memory unless Flow grants context",
      budgetImpact: "Usage metered by connected agent",
      approvalMode: tool.permission,
      attachments: [tool.scopes]
    }));
  }

  if (tab === "Memory") {
    return memoryPartitions.map((partition) => ({
      id: `palette-memory-${partition.name.toLowerCase().replaceAll(" ", "-")}`,
      name: partition.name,
      type: "memory",
      category: partition.workflow,
      riskLevel: partition.sensitivity,
      permissions: partition.permissionLevel,
      memoryAccess: partition.access,
      budgetImpact: "$0.00",
      approvalMode: partition.permissionLevel,
      attachments: [partition.description]
    }));
  }

  return builderControls.map((control) => ({
    id: `palette-control-${control.name.toLowerCase().replaceAll(" ", "-")}`,
    name: control.name,
    type: "control",
    category: "Control",
    riskLevel: control.riskLevel,
    permissions: control.permissions,
    memoryAccess: control.memoryAccess,
    budgetImpact: control.budgetImpact,
    approvalMode: control.approvalMode,
    attachments: [control.permissions]
  }));
}

function WorkflowTemplateCard({ workflow }: { workflow: typeof workflowTemplates[number] }) {
  return (
    <article className="agentCard">
      <div className="agentTopline">
        <span className="verifiedBadge">Template</span>
        <ComingSoonButton>Install Flow</ComingSoonButton>
      </div>
      <h3>{workflow.name}</h3>
      <div className="agentStats expanded">
        <Metric label="Agents" value={workflow.agents} />
        <Metric label="Tools" value={workflow.mcps} />
        <Metric label="Memory" value={workflow.memory} />
        <Metric label="Access" value={workflow.permissions} />
        <Metric label="Budget" value={workflow.budget} />
      </div>
    </article>
  );
}
