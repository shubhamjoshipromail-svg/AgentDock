// Static config + demo scaffolding still referenced by mounted surfaces:
//   - `sections`      → the primary nav (Shell)
//   - `agents`, `mcpTools`, `builderControls`, `memoryPartitions`,
//     `recommendedBuilderNodes`, `stepDisplayNames`
//                       → the Build canvas palette / seed nodes / labels
//
// The former demo feeds (fabricated audit events, cost/credential tables,
// workflow templates, runtime modes, the simulate event fixtures) were deleted
// in the Chunk 20 "delete the theater" pass — they had no live consumer and only
// risked being mistaken for real data.
import type {
  Agent,
  BuilderNode,
  ControlComponent,
  MemoryPartition,
  Section
} from "../lib/types";

// Alpha nav: Guides is hidden (it was a "coming soon" placeholder with no
// backend). Workspace, Store, and Profile are the real, working surfaces.
export const sections: Section[] = ["Workspace", "Store", "Profile"];

export const agents: Agent[] = [
  {
    name: "Job Discovery Agent",
    category: "Discovery",
    provider: "OpenAI",
    requiredAccess: "Search + Job Search Memory",
    defaultMode: "Autonomous discovery",
    verified: true,
    description: "Finds matching AI infrastructure roles, ranks fit, and routes targets into the workflow."
  },
  {
    name: "Company Research Agent",
    category: "Research",
    provider: "Claude",
    requiredAccess: "Search + Research Memory",
    defaultMode: "Human-reviewed notes",
    verified: true,
    description: "Builds company briefs with leadership, funding, product, and hiring signals."
  },
  {
    name: "Resume Tailoring Agent",
    category: "Documents",
    provider: "OpenAI",
    requiredAccess: "Resume Memory",
    defaultMode: "Approval before export",
    verified: true,
    description: "Maps role requirements to resume bullets and produces tracked document edits."
  },
  {
    name: "Outreach Draft Agent",
    category: "Communications",
    provider: "Gemini",
    requiredAccess: "Gmail drafts + Research Memory",
    defaultMode: "Never send without approval",
    verified: true,
    description: "Creates recruiter and hiring manager messages for approval-only outreach."
  },
  {
    name: "Shopping Agent",
    category: "Commerce",
    provider: "Open-source",
    requiredAccess: "Commerce memory only",
    defaultMode: "Blocked from job-search memory",
    verified: false,
    description: "Compares products and prices with strict memory isolation."
  },
  {
    name: "Finance Agent",
    category: "Finance",
    provider: "Claude",
    requiredAccess: "Finance Memory",
    defaultMode: "Approval required",
    verified: true,
    description: "Summarizes finance tasks with restricted memory defaults."
  },
  {
    name: "Health Agent",
    category: "Health",
    provider: "OpenAI",
    requiredAccess: "Health Memory",
    defaultMode: "Restricted by default",
    verified: true,
    description: "Handles health notes with restricted memory defaults."
  }
];

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
  "Approval Gate": "Approval Gate"
};

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

export const builderControls: ControlComponent[] = [
  { name: "Approval Gate", riskLevel: "Low", permissions: "Approves drafts, sends, exports, and applications", memoryAccess: "Reads policy context only", budgetImpact: "$0.00", approvalMode: "Human approval required" },
  { name: "Budget Cap", riskLevel: "Low", permissions: "Pauses workflow before spend limit", memoryAccess: "No memory access", budgetImpact: "$5/week", approvalMode: "Automatic enforcement" },
  { name: "Human Review", riskLevel: "Low", permissions: "Queues artifacts before external action", memoryAccess: "Scoped artifact preview", budgetImpact: "$0.00", approvalMode: "Manual review" },
  { name: "Blocked Action", riskLevel: "Medium", permissions: "Blocks sends, payments, broad exports, and applications", memoryAccess: "No memory access", budgetImpact: "$0.00", approvalMode: "Always blocked" },
  { name: "Scoped Credential", riskLevel: "Medium", permissions: "Temporary model/tool credential metadata", memoryAccess: "No memory access", budgetImpact: "Routes through cap", approvalMode: "Policy-gated" },
  { name: "Memory Firewall", riskLevel: "Low", permissions: "Enforces read/write/share/delete grants", memoryAccess: "Partition-aware", budgetImpact: "$0.00", approvalMode: "Policy-gated" }
];

export const recommendedBuilderNodes: BuilderNode[] = [
  { id: "goal-job-search", name: "User Goal", type: "goal", category: "Workflow intent", permissions: "Defines requested outcome", memoryAccess: "No direct memory access", budgetImpact: "$0.00", approvalMode: "User-authored", attachments: ["Help me manage job applications and outreach without sending emails or applying automatically."] },
  { id: "agent-job-discovery", name: "Job Discovery Agent", type: "agent", provider: "OpenAI", category: "Discovery", permissions: "Search roles, rank fit, write targets", memoryAccess: "Job Search Memory: read/write", budgetImpact: "Metadata only", approvalMode: "Autonomous discovery", attachments: ["Search MCP", "Job Search Memory"] },
  { id: "agent-company-research", name: "Company Research Agent", type: "agent", provider: "Claude", category: "Research", permissions: "Summarize companies, write research notes", memoryAccess: "Research Memory: read/write", budgetImpact: "Metadata only", approvalMode: "Human-reviewed notes", attachments: ["Search MCP", "Research Memory"] },
  { id: "agent-resume-tailoring", name: "Resume Tailoring Agent", type: "agent", provider: "OpenAI", category: "Documents", permissions: "Create resume drafts", memoryAccess: "Resume Memory: read/write", budgetImpact: "Metadata only", approvalMode: "Approval before export", attachments: ["Docs / Notion MCP", "Resume Memory"] },
  { id: "agent-outreach-draft", name: "Outreach Draft Agent", type: "agent", provider: "Gemini", category: "Communications", permissions: "Create Gmail drafts only", memoryAccess: "Job Search Memory: read, Outreach History: write", budgetImpact: "Metadata only", approvalMode: "Never send without approval", attachments: ["Gmail Draft MCP", "Job Search Memory"] },
  { id: "control-approval-gate", name: "Approval Gate", type: "control", category: "Control", riskLevel: "Low", permissions: "Send/apply actions require user approval", memoryAccess: "Policy context only", budgetImpact: "$0.00", approvalMode: "2 approval gates", attachments: ["Send/apply actions require user approval"] }
];
