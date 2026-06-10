// Mock/demo data and pure helpers shared across components (moved verbatim from app/page.tsx).
import type {
  Agent,
  AuditEvent,
  BuilderNode,
  ControlComponent,
  EventType,
  MemoryPartition,
  PersistedActivityLog,
  RuntimeMode,
  Section
} from "./types";

export const sections: Section[] = ["Build", "Store", "Flows", "Control", "Profile"];
export const flow = ["Discovery", "Research", "Resume", "Outreach"];

export const agents: Agent[] = [
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

export const workflowAgents = agents.slice(0, 4);

export const mcpTools = [
  { name: "GitHub MCP", scopes: "Read repos, draft PR notes", risk: "Medium", permission: "Approval required for writes", workflows: "Coding Review, Research Briefs", verified: "Verified" },
  { name: "Gmail draft-only MCP", scopes: "Create drafts, never send", risk: "High", permission: "Draft-only by default", workflows: "Job Search, Sales Outreach", verified: "Verified" },
  { name: "Google Calendar MCP", scopes: "Read availability", risk: "Medium", permission: "No scheduling without approval", workflows: "Productivity, Recruiting", verified: "Verified" },
  { name: "Docs / Notion MCP", scopes: "Create notes and drafts", risk: "Medium", permission: "Workspace-scoped", workflows: "Research, Coding Review", verified: "Verified" },
  { name: "Search MCP", scopes: "Public web discovery", risk: "Low", permission: "Allowed within budget", workflows: "All workflows", verified: "Verified" },
  { name: "Stripe MCP later", scopes: "Usage and billing metadata", risk: "High", permission: "Approval always required", workflows: "Billing Ops", verified: "Planned" }
];

export const stepDisplayNames: Record<string, string> = {
  "User Goal": "Goal",
  "Job Discovery Agent": "Discovery",
  "Company Research Agent": "Research",
  "Resume Tailoring Agent": "Resume",
  "Outreach Draft Agent": "Outreach",
  "A2UI Approval Gate": "Approval Gate"
};

export const workflowTemplates = [
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

export const memoryPartitions: MemoryPartition[] = [
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

export const baseAuditEvents: AuditEvent[] = [
  { event: "Resume Tailoring Agent read Job Search Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Job Search Memory", cost: "$0.02", decision: "allowed" },
  { event: "Outreach Draft Agent wrote to Outreach History", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail draft-only MCP", permission: "write draft", memory: "Research Memory", cost: "$0.03", decision: "allowed" },
  { event: "Shopping Agent was blocked from Health Memory", type: "blocked action", agent: "Shopping Agent", workflow: "None", tool: "Memory Firewall", permission: "read", memory: "Health Memory", cost: "$0.00", decision: "blocked" },
  { event: "Research Agent requested access to Company Preferences", type: "approval request", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "request_access", memory: "Global Profile", cost: "$0.00", decision: "approval_required" },
  { event: "Scoped access minted for Outreach Draft Agent", type: "credential minting", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Access Gateway", permission: "Gmail draft-only", memory: "None", cost: "$0.00", decision: "approved" }
];

export const simulatedRunEvents: AuditEvent[] = [
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

export const credentials = [
  { provider: "OpenAI", agent: "Job Discovery Agent", workflow: "Job Search Automation", scope: "Model calls within $5 weekly cap", expiry: "7 days", status: "Active" },
  { provider: "Anthropic", agent: "Company Research Agent", workflow: "Job Search Automation", scope: "Research summaries only", expiry: "7 days", status: "Active" },
  { provider: "Gemini", agent: "Outreach Draft Agent", workflow: "Job Search Automation", scope: "Draft generation only", expiry: "24 hours", status: "Active" },
  { provider: "Google Workspace", agent: "Outreach Draft Agent", workflow: "Job Search Automation", scope: "Gmail drafts; send blocked", expiry: "24 hours", status: "Approval gated" },
  { provider: "GitHub", agent: "Code Review Agent", workflow: "Coding Review Stack", scope: "Read repos; draft comments", expiry: "Paused", status: "Paused" }
];

export const providerUsage = [
  { provider: "OpenAI", usage: "$1.12", cap: "$3.00" },
  { provider: "Anthropic", usage: "$0.54", cap: "$2.00" },
  { provider: "Gemini", usage: "$0.31", cap: "$1.50" },
  { provider: "Google Workspace", usage: "$0.00", cap: "Draft-only" }
];

export const runtimeModes: RuntimeMode[] = [
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

export const builderControls: ControlComponent[] = [
  { name: "A2UI Approval Gate", riskLevel: "Low", permissions: "Approves drafts, sends, exports, and applications", memoryAccess: "Reads policy context only", budgetImpact: "$0.00", approvalMode: "Human approval required" },
  { name: "Budget Cap", riskLevel: "Low", permissions: "Pauses workflow before spend limit", memoryAccess: "No memory access", budgetImpact: "$5/week", approvalMode: "Automatic enforcement" },
  { name: "Human Review", riskLevel: "Low", permissions: "Queues artifacts before external action", memoryAccess: "Scoped artifact preview", budgetImpact: "$0.00", approvalMode: "Manual review" },
  { name: "Blocked Action", riskLevel: "Medium", permissions: "Blocks sends, payments, broad exports, and applications", memoryAccess: "No memory access", budgetImpact: "$0.00", approvalMode: "Always blocked" },
  { name: "Scoped Credential", riskLevel: "Medium", permissions: "Temporary model/tool credential metadata", memoryAccess: "No memory access", budgetImpact: "Routes through cap", approvalMode: "Policy-gated" },
  { name: "Memory Firewall", riskLevel: "Low", permissions: "Enforces read/write/share/delete grants", memoryAccess: "Partition-aware", budgetImpact: "$0.00", approvalMode: "Policy-gated" }
];

export const recommendedBuilderNodes: BuilderNode[] = [
  { id: "goal-job-search", name: "User Goal", type: "goal", category: "Workflow intent", permissions: "Defines requested outcome", memoryAccess: "No direct memory access", budgetImpact: "$0.00", approvalMode: "User-authored", attachments: ["Help me manage job applications and outreach without sending emails or applying automatically."] },
  { id: "agent-job-discovery", name: "Job Discovery Agent", type: "agent", provider: "OpenAI", category: "Discovery", trustScore: 96, permissions: "Search roles, rank fit, write targets", memoryAccess: "Job Search Memory: read/write", budgetImpact: "$0.09/task", approvalMode: "Autonomous discovery", attachments: ["Search MCP", "Job Search Memory"] },
  { id: "agent-company-research", name: "Company Research Agent", type: "agent", provider: "Claude", category: "Research", trustScore: 92, permissions: "Summarize companies, write research notes", memoryAccess: "Research Memory: read/write", budgetImpact: "$0.18/task", approvalMode: "Human-reviewed notes", attachments: ["Search MCP", "Research Memory"] },
  { id: "agent-resume-tailoring", name: "Resume Tailoring Agent", type: "agent", provider: "OpenAI", category: "Documents", trustScore: 89, permissions: "Create resume drafts", memoryAccess: "Resume Memory: read/write", budgetImpact: "$0.24/task", approvalMode: "Approval before export", attachments: ["Docs / Notion MCP", "Resume Memory"] },
  { id: "agent-outreach-draft", name: "Outreach Draft Agent", type: "agent", provider: "Gemini", category: "Communications", trustScore: 94, permissions: "Create Gmail drafts only", memoryAccess: "Job Search Memory: read, Outreach History: write", budgetImpact: "$0.11/task", approvalMode: "Never send without approval", attachments: ["Gmail Draft MCP", "Job Search Memory"] },
  { id: "control-approval-gate", name: "A2UI Approval Gate", type: "control", category: "Control", riskLevel: "Low", permissions: "Send/apply actions require user approval", memoryAccess: "Policy context only", budgetImpact: "$0.00", approvalMode: "2 approval gates", attachments: ["Send/apply actions require user approval"] }
];

export const builderSimulateEvents: AuditEvent[] = [
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

export const jobSearchWorkflowPayload = {
  name: "Job Search Automation",
  goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 150,
  approvalMode: "approval_gated" as const,
  agents: [
    { agentName: "Job Discovery Agent", roleInWorkflow: "Discover roles", routeOrder: 1, defaultMode: "Autonomous discovery" },
    { agentName: "Company Research Agent", roleInWorkflow: "Research targets", routeOrder: 2, defaultMode: "Human-reviewed notes" },
    { agentName: "Resume Tailoring Agent", roleInWorkflow: "Tailor resume", routeOrder: 3, defaultMode: "Approval before export" },
    { agentName: "Outreach Draft Agent", roleInWorkflow: "Draft outreach", routeOrder: 4, defaultMode: "Draft-only" }
  ]
};

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const eventTypeLabels: Record<string, EventType> = {
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

export function activityLogToAuditEvent(log: PersistedActivityLog): AuditEvent {
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
