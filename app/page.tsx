"use client";

import { useEffect, useMemo, useState } from "react";
import { getProviders, SessionProvider, signIn, signOut, useSession } from "next-auth/react";

type Section = "Control Plane" | "Builder" | "Store" | "Workflows" | "Profile" | "Keys & Billing" | "Activity" | "Architecture";
type StoreTab = "Agents" | "MCPs / Tools" | "Workflows";
type BuilderPaletteTab = "Agents" | "MCPs / Tools" | "Memory" | "Controls";
type BuilderNodeType = "goal" | "agent" | "mcp" | "memory" | "control";
type RuntimeModeName = "Provider API Mode" | "AgentDock Sandbox Mode" | "User Cloud Mode" | "Local Mode";
type Decision = "allowed" | "blocked" | "approval_required" | "approved" | "denied";
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

const sections: Section[] = ["Control Plane", "Builder", "Store", "Workflows", "Profile", "Keys & Billing", "Activity", "Architecture"];
const flow = ["Job Discovery", "Company Research", "Resume Tailoring", "Outreach Draft"];

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
  { event: "Scoped credential minted for Outreach Draft Agent", type: "credential minting", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Credential Gateway", permission: "Gmail draft-only", memory: "None", cost: "$0.00", decision: "approved" }
];

const simulatedRunEvents: AuditEvent[] = [
  { event: "Job Discovery Agent searched 12 roles", type: "MCP/tool use", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "search", memory: "Job Search Memory", cost: "$0.09", decision: "allowed" },
  { event: "Company Research Agent summarized 3 companies", type: "A2A handoff", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "write notes", memory: "Research Memory", cost: "$0.18", decision: "allowed" },
  { event: "Resume Tailoring Agent read Resume Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Resume Memory", cost: "$0.02", decision: "allowed" },
  { event: "Resume Tailoring Agent created a resume draft and requires approval", type: "approval request", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Docs / Notion MCP", permission: "create draft", memory: "Resume Memory", cost: "$0.24", decision: "approval_required" },
  { event: "Outreach Draft Agent created 3 Gmail drafts and requires approval", type: "approval request", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail draft-only MCP", permission: "create drafts", memory: "Research Memory", cost: "$0.11", decision: "approval_required" },
  { event: "Policy Engine blocked direct application submission", type: "blocked action", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Policy Engine", permission: "apply to job", memory: "Job Search Memory", cost: "$0.00", decision: "blocked" },
  { event: "Memory Firewall limited Outreach Agent to Job Search Memory", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "scope memory", memory: "Job Search Memory", cost: "$0.00", decision: "allowed" },
  { event: "Credential Gateway minted a temporary model credential", type: "credential minting", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Credential Gateway", permission: "temporary model credential", memory: "None", cost: "$0.00", decision: "approved" },
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
  { id: "goal-job-search", name: "User Goal", type: "goal", category: "Workflow intent", permissions: "Defines requested outcome", memoryAccess: "No direct memory access", budgetImpact: "$0.00", approvalMode: "User-authored", attachments: ["Help me manage job applications and outreach without sending or applying automatically."] },
  { id: "agent-job-discovery", name: "Job Discovery Agent", type: "agent", provider: "OpenAI", category: "Discovery", trustScore: 96, permissions: "Search roles, rank fit, write targets", memoryAccess: "Job Search Memory: read/write", budgetImpact: "$0.09/task", approvalMode: "Autonomous discovery", attachments: ["Search MCP", "Job Search Memory"] },
  { id: "agent-company-research", name: "Company Research Agent", type: "agent", provider: "Claude", category: "Research", trustScore: 92, permissions: "Summarize companies, write research notes", memoryAccess: "Research Memory: read/write", budgetImpact: "$0.18/task", approvalMode: "Human-reviewed notes", attachments: ["Search MCP", "Research Memory"] },
  { id: "agent-resume-tailoring", name: "Resume Tailoring Agent", type: "agent", provider: "OpenAI", category: "Documents", trustScore: 89, permissions: "Create resume drafts", memoryAccess: "Resume Memory: read/write", budgetImpact: "$0.24/task", approvalMode: "Approval before export", attachments: ["Docs / Notion MCP", "Resume Memory"] },
  { id: "agent-outreach-draft", name: "Outreach Draft Agent", type: "agent", provider: "Gemini", category: "Communications", trustScore: 94, permissions: "Create Gmail drafts only", memoryAccess: "Job Search Memory: read, Outreach History: write", budgetImpact: "$0.11/task", approvalMode: "Never send without approval", attachments: ["Gmail Draft MCP", "Job Search Memory"] },
  { id: "control-approval-gate", name: "A2UI Approval Gate", type: "control", category: "Control", riskLevel: "Low", permissions: "Send/apply actions require user approval", memoryAccess: "Policy context only", budgetImpact: "$0.00", approvalMode: "2 approval gates", attachments: ["Send/apply actions require user approval"] }
];

const builderSimulateEvents: AuditEvent[] = [
  { event: "Orchestration Agent recommended Job Search Automation stack", type: "A2A handoff", agent: "AgentDock Orchestration Agent", workflow: "Job Search Automation", tool: "Builder", permission: "recommend stack", memory: "Job Search Memory", cost: "$0.00", decision: "allowed" },
  { event: "Job Discovery Agent searched 12 roles", type: "MCP/tool use", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "search", memory: "Job Search Memory", cost: "$0.09", decision: "allowed" },
  { event: "Company Research Agent summarized 3 companies", type: "A2A handoff", agent: "Company Research Agent", workflow: "Job Search Automation", tool: "Search MCP", permission: "write notes", memory: "Research Memory", cost: "$0.18", decision: "allowed" },
  { event: "Resume Tailoring Agent read Resume Memory", type: "memory access", agent: "Resume Tailoring Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Resume Memory", cost: "$0.02", decision: "allowed" },
  { event: "Outreach Draft Agent requested Gmail draft access", type: "approval request", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Gmail Draft MCP", permission: "create drafts", memory: "Job Search Memory", cost: "$0.11", decision: "approval_required" },
  { event: "A2UI Approval Gate created 3 pending approvals", type: "approval request", agent: "A2UI Approval Gate", workflow: "Job Search Automation", tool: "A2UI Control Plane", permission: "human review", memory: "None", cost: "$0.00", decision: "approval_required" },
  { event: "Policy Engine blocked direct application submission", type: "blocked action", agent: "Job Discovery Agent", workflow: "Job Search Automation", tool: "Policy Engine", permission: "apply to job", memory: "Job Search Memory", cost: "$0.00", decision: "blocked" },
  { event: "Memory Firewall blocked unrelated Finance Memory access", type: "memory access", agent: "Outreach Draft Agent", workflow: "Job Search Automation", tool: "Memory Firewall", permission: "read", memory: "Finance Memory", cost: "$0.00", decision: "blocked" },
  { event: "Credential Gateway minted temporary scoped credentials", type: "credential minting", agent: "AgentDock Orchestration Agent", workflow: "Job Search Automation", tool: "Credential Gateway", permission: "temporary model/tool credentials", memory: "None", cost: "$0.00", decision: "approved" }
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

export default function Home() {
  const [activeSection, setActiveSection] = useState<Section>("Control Plane");
  const [storeTab, setStoreTab] = useState<StoreTab>("Agents");
  const [builderPaletteTab, setBuilderPaletteTab] = useState<BuilderPaletteTab>("Agents");
  const [builderPrompt, setBuilderPrompt] = useState("Help me manage job applications and outreach without sending or applying automatically.");
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
    setActiveSection("Control Plane");
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

      {activeSection === "Control Plane" && (
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
      {activeSection === "Builder" && (
        <Builder
          prompt={builderPrompt}
          setPrompt={setBuilderPrompt}
          paletteTab={builderPaletteTab}
          setPaletteTab={setBuilderPaletteTab}
          nodes={builderNodes}
          selectedNodeId={selectedBuilderNodeId}
          setSelectedNodeId={setSelectedBuilderNodeId}
          saved={builderSaved}
          onRecommend={recommendBuilderStack}
          onAddNode={addBuilderNode}
          onRemoveNode={removeBuilderNode}
          onSave={saveBuilderWorkflow}
          onSimulate={simulateBuilderRun}
          onViewLogs={() => setActiveSection("Activity")}
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
      {activeSection === "Workflows" && <Workflows runHistory={runHistory} onRun={runDemoWorkflow} onOpenActivity={() => setActiveSection("Activity")} />}
      {activeSection === "Profile" && (
        <Profile
          selectedMemory={selectedMemory}
          onSelectMemory={setSelectedMemory}
          defaultAgent={defaultAgent}
        />
      )}
      {activeSection === "Keys & Billing" && <KeysBilling spend={spend} />}
      {activeSection === "Activity" && <Activity events={events} />}
      {activeSection === "Architecture" && <Architecture />}
      </main>
    </SessionProvider>
  );
}

function AuthStatus() {
  const { data: session, status } = useSession();
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    getProviders()
      .then((providers) => setGoogleAvailable(Boolean(providers?.google)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  if (status === "loading") {
    return <div className="authBox mutedAuth">Checking session...</div>;
  }

  if (session?.user) {
    return (
      <div className="authBox signedIn">
        {session.user.image ? <img src={session.user.image} alt="" /> : <span className="authAvatar">AD</span>}
        <div>
          <strong>{session.user.name ?? "AgentDock user"}</strong>
          <span>Signed in as {session.user.email ?? session.user.name}</span>
        </div>
        <button className="secondaryButton smallButton" onClick={() => signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="authBox">
      {googleAvailable ? (
        <button className="secondaryButton smallButton" onClick={() => signIn("google")}>Sign in with Google</button>
      ) : (
        <span>Set Google OAuth env vars to enable sign-in.</span>
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
  return (
    <section className="platformPage">
      <div className="platformHero">
        <div>
          <p className="eyebrow">A2UI control plane</p>
          <h1>Manage every AI agent from one trusted control plane.</h1>
          <p className="subheadline">
            AgentDock coordinates agents, MCP tools, scoped credentials, memory partitions, approvals,
            spend, and logs from one clean operator surface.
          </p>
          <div className="trustRow">
            {["Cross-model", "MCP-ready", "A2A orchestration", "Memory Firewall", "Scoped credentials", "Human approvals"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="heroActions">
            <button className="primaryButton" onClick={onRun}>Run demo workflow</button>
            <button className="secondaryButton" onClick={() => onOpenSection("Store")}>Open Store</button>
          </div>
        </div>
        <div className="heroPanel">
          <div className="panelHeader">
            <span>Job Search Automation</span>
            <strong>Active</strong>
          </div>
          <div className="controlPreview">
            <MetricCard label="Active workflows" value="3" />
            <MetricCard label="Pending approvals" value={`${pendingApprovals}`} />
            <MetricCard label="Spend this week" value={`$${spend.toFixed(2)}`} />
            <MetricCard label="Installed agents" value={`${agents.length}`} />
          </div>
          <div className="heroPolicy">
            <span>Policy summary</span>
            <p>Agents can search, summarize, draft, and write scoped memory. Sending, applying, broad sharing, and restricted memory access are blocked or approval-gated.</p>
          </div>
        </div>
      </div>

      <div className="dashboardGrid">
        <Card title="Active workflows" meta="3 running">
          <WorkflowMini name="Job Search Automation" status="Active" budget={`$${spend.toFixed(2)} / $5.00`} />
          <WorkflowMini name="Research Brief Generator" status="Ready" budget="$0.42 / $3.00" />
          <WorkflowMini name="Coding Review Stack" status="Paused" budget="$0.00 / $7.00" />
        </Card>
        <Card title="Pending approvals" meta={`${pendingApprovals}`}>
          {["Resume draft requires approval", "3 Gmail drafts require approval", "Company Preferences access request"].map((item) => (
            <div className="approvalItem" key={item}>{item}</div>
          ))}
        </Card>
        <Card title="Installed agents" meta={`${agents.length}`}>
          {workflowAgents.map((agent) => (
            <div className="compactItem" key={agent.name}>
              <div>
                <strong>{agent.name}</strong>
                <span>{agent.provider} - {agent.name === defaultAgent ? "Default" : agent.defaultMode}</span>
              </div>
              <span className="verifiedBadge">Verified</span>
            </div>
          ))}
        </Card>
        <Card title="A2A route view" meta="Approval-gated">
          <RouteView />
        </Card>
        <Card title="Memory Firewall status" meta="Enforced">
          <DetailBlock label="Default posture" value="Workflow-scoped memory only" />
          <DetailBlock label="Restricted partitions" value="Finance Memory and Health Memory blocked by default" />
          <DetailBlock label="Latest decision" value="Outreach limited to Job Search Memory" />
        </Card>
        <Card title="Credential Gateway status" meta="Healthy">
          <DetailBlock label="Raw provider keys" value="Never exposed to agents" />
          <DetailBlock label="Active scoped credentials" value="4 temporary credentials" />
          <DetailBlock label="Latest mint" value="Temporary model credential for Job Search Automation" />
        </Card>
        <Card title="Latest audit events" meta="Live">
          <AuditList events={events.slice(0, 6)} compact />
        </Card>
        <Card title="Spend monitor" meta="$5 weekly cap">
          <div className="costWidget inlineCost">
            <span>Job Search Automation</span>
            <strong>${spend.toFixed(2)} / $5.00</strong>
            <div className="meter"><span style={{ width: `${Math.min(100, (spend / 5) * 100)}%` }} /></div>
          </div>
          <div className="softNote">Policy Engine will pause runs before the cap is exceeded.</div>
        </Card>
        <Card title="Workflow run history" meta={`${runHistory.length} runs`}>
          {runHistory.slice(0, 3).map((run) => (
            <div className="approvalItem" key={run}>{run}</div>
          ))}
        </Card>
      </div>
    </section>
  );
}

function Builder({
  prompt,
  setPrompt,
  paletteTab,
  setPaletteTab,
  nodes,
  selectedNodeId,
  setSelectedNodeId,
  saved,
  onRecommend,
  onAddNode,
  onRemoveNode,
  onSave,
  onSimulate,
  onViewLogs,
  onSetDefault
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  paletteTab: BuilderPaletteTab;
  setPaletteTab: (tab: BuilderPaletteTab) => void;
  nodes: BuilderNode[];
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  saved: boolean;
  onRecommend: () => void;
  onAddNode: (node: BuilderNode) => void;
  onRemoveNode: (id: string) => void;
  onSave: () => void;
  onSimulate: () => void;
  onViewLogs: () => void;
  onSetDefault: (agent: string) => void;
}) {
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const paletteItems = getBuilderPaletteItems(paletteTab);
  const { data: session } = useSession();
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      setSaveMessage("Sign in with Google to save workflows to your AgentDock profile.");
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
        throw new Error(data.message ?? "Workflow save failed.");
      }

      onSave();
      setSaveMessage("Workflow saved to your AgentDock profile.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Workflow save failed.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  return (
    <section className="platformPage builderPage">
      <PageHeader
        eyebrow="A2UI Workflow Builder"
        title="Compose agents, tools, memory, permissions, budgets, and approval gates."
        copy="Build mode lets users compose the system. Operate mode lets users approve, monitor, and revoke actions as agents run."
      />

      <div className="builderPromptBar">
        <div>
          <span>AgentDock Orchestration Agent</span>
          <label htmlFor="builderPrompt">What do you want this workflow to do?</label>
        </div>
        <textarea
          id="builderPrompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
        />
        <button className="primaryButton" onClick={onRecommend}>Recommend stack</button>
      </div>

      {saved && (
        <div className="builderToast">
          <strong>Workflow saved locally.</strong>
          <span>Mock policy, memory, credential, and run state updated for the demo surface.</span>
        </div>
      )}
      {saveMessage && (
        <div className="builderToast">
          <strong>{saveMessage.includes("saved") ? "Saved" : "Save workflow"}</strong>
          <span>{saveMessage}</span>
        </div>
      )}

      <div className="builderGrid">
        <aside className="builderPalette">
          <div className="panelHeader"><span>Component palette</span><strong>Click to add</strong></div>
          <div className="paletteTabs">
            {(["Agents", "MCPs / Tools", "Memory", "Controls"] as BuilderPaletteTab[]).map((tab) => (
              <button className={paletteTab === tab ? "tabButton active" : "tabButton"} key={tab} onClick={() => setPaletteTab(tab)}>{tab}</button>
            ))}
          </div>
          <div className="paletteList">
            {paletteItems.map((item) => (
              <div className="paletteItem" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.category ?? item.provider ?? item.riskLevel}</span>
                </div>
                <button className="secondaryButton smallButton" onClick={() => onAddNode(item)}>Add</button>
              </div>
            ))}
          </div>
        </aside>

        <section className="builderCanvas">
          <div className="canvasHeader">
            <div>
              <span>Workflow canvas</span>
              <strong>Job Search Automation</strong>
            </div>
            <p>Agents are apps. MCPs are tools. Workflows are bundles. Memory is partitioned context. AgentDock is the control plane.</p>
          </div>
          <div className="builderGraph">
            {nodes.map((node, index) => (
              <div className="graphStep" key={node.id}>
                <button
                  className={selectedNode?.id === node.id ? "builderNode selected" : "builderNode"}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span className={`nodeType ${node.type}`}>{node.type}</span>
                  <strong>{node.name}</strong>
                  <small>{node.provider ?? node.category ?? node.approvalMode}</small>
                  {!!node.attachments?.length && (
                    <div className="nodeAttachments">
                      {node.attachments.map((attachment) => <span key={attachment}>{attachment}</span>)}
                    </div>
                  )}
                </button>
                {index < nodes.length - 1 && <span className="graphArrow" aria-hidden="true">-&gt;</span>}
              </div>
            ))}
          </div>
        </section>

        <aside className="builderInspector">
          <div className="panelHeader"><span>Inspector</span><strong>{selectedNode?.type ?? "None"}</strong></div>
          {selectedNode ? (
            <>
              <h3>{selectedNode.name}</h3>
              <div className="detailStack">
                <DetailBlock label="Type" value={selectedNode.type} />
                <DetailBlock label="Provider/category" value={selectedNode.provider ?? selectedNode.category ?? "Control"} />
                {selectedNode.trustScore ? <DetailBlock label="Trust score" value={`${selectedNode.trustScore}`} /> : null}
                {selectedNode.riskLevel ? <DetailBlock label="Risk level" value={selectedNode.riskLevel} /> : null}
                <DetailBlock label="Permissions" value={selectedNode.permissions} />
                <DetailBlock label="Memory access" value={selectedNode.memoryAccess} />
                <DetailBlock label="Budget impact" value={selectedNode.budgetImpact} />
                <DetailBlock label="Approval mode" value={selectedNode.approvalMode} />
              </div>
              <div className="buttonPair inspectorActions">
                {selectedNode.type === "agent" && <button className="secondaryButton smallButton" onClick={() => onSetDefault(selectedNode.name)}>Set as default</button>}
                <button className="revokeButton" onClick={() => onRemoveNode(selectedNode.id)}>Remove</button>
              </div>
            </>
          ) : (
            <p>Select a workflow node to inspect its policy, memory, budget, and approval posture.</p>
          )}
        </aside>
      </div>

      <RuntimeModeSection context="builder" />

      <div className="validationPanel">
        <div className="panelHeader"><span>Policy validation</span><strong>Workflow valid with 2 approval gates and 0 critical risks.</strong></div>
        <div className="policyCheckGrid">
          {[
            "Email sending is blocked",
            "Job applications require approval",
            "Gmail access is draft-only",
            "Finance Memory and Health Memory are blocked",
            "Spend cap is $5/week",
            "All A2A handoffs will be logged",
            "Scoped credentials required for model/tool access"
          ].map((check) => <span key={check}>{check}</span>)}
        </div>
        <div className="builderActionBar">
          <button className="primaryButton" onClick={saveWorkflowToProfile} disabled={savingWorkflow}>
            {savingWorkflow ? "Saving..." : "Save workflow"}
          </button>
          <button className="secondaryButton" onClick={onSimulate}>Simulate run</button>
          <button className="secondaryButton" onClick={onViewLogs}>View audit logs</button>
        </div>
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
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Store" title="Install agents like apps. Rank them like infrastructure." copy="Every install preview includes trust, cost, token efficiency, access, compatible workflows, and default policy posture." />
      <div className="tabRow">
        {(["Agents", "MCPs / Tools", "Workflows"] as StoreTab[]).map((item) => (
          <button className={tab === item ? "tabButton active" : "tabButton"} key={item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === "Agents" && (
        <div className="agentGrid">
          {agents.map((agent, index) => (
            <article className="agentCard" key={agent.name}>
              <div className="agentTopline">
                <div className="badgeGroup">
                  <span className="rankText">#{index + 1} {agent.category}</span>
                  {agent.verified && <span className="verifiedBadge">Verified</span>}
                </div>
                <div className="buttonPair">
                  <button className="secondaryButton smallButton">Install</button>
                  <button className="secondaryButton smallButton" onClick={() => setDefaultAgent(agent.name)}>
                    {defaultAgent === agent.name ? "Default" : "Set default"}
                  </button>
                </div>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.description}</p>
              <div className="agentStats expanded">
                <Metric label="Provider" value={agent.provider} />
                <Metric label="Trust" value={`${agent.trustScore}`} />
                <Metric label="Cost/task" value={agent.costPerTask} />
                <Metric label="Token efficiency" value={agent.tokenEfficiency} />
                <Metric label="Required access" value={agent.requiredAccess} />
                <Metric label="Default mode" value={agent.defaultMode} />
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "MCPs / Tools" && (
        <div className="mcpGrid">
          {mcpTools.map((tool) => (
            <article className="mcpCard" key={tool.name}>
              <div className="panelHeader">
                <span>{tool.verified}</span>
                <strong>{tool.risk} risk</strong>
              </div>
              <h3>{tool.name}</h3>
              <p>{tool.scopes}</p>
              <Metric label="Recommended permission" value={tool.permission} />
              <Metric label="Compatible workflows" value={tool.workflows} />
              <button className="secondaryButton smallButton">Connect</button>
            </article>
          ))}
        </div>
      )}
      {tab === "Workflows" && (
        <div className="templateGrid">
          {workflowTemplates.map((workflow) => (
            <WorkflowTemplateCard workflow={workflow} key={workflow.name} />
          ))}
        </div>
      )}
    </section>
  );
}

function Workflows({ runHistory, onRun, onOpenActivity }: { runHistory: string[]; onRun: () => void; onOpenActivity: () => void }) {
  const { data: session } = useSession();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [loadingSavedWorkflows, setLoadingSavedWorkflows] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

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
        throw new Error(data.message ?? "Unable to load saved workflows.");
      }

      setSavedWorkflows(data.workflows ?? []);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to load saved workflows.");
    } finally {
      setLoadingSavedWorkflows(false);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
  }, [session?.user?.email]);

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      setWorkflowMessage("Sign in with Google to save workflows to your AgentDock profile.");
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
        throw new Error(data.message ?? "Workflow save failed.");
      }

      setWorkflowMessage("Workflow saved to your AgentDock profile.");
      setSavedWorkflows((current) => [data.workflow, ...current]);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Workflow save failed.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  const visibleWorkflows = session?.user ? savedWorkflows : [];

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Workflows" title="Saved workflows are policy bundles, not loose prompts." copy="Each workflow stores its agent stack, MCP access, memory partitions, budgets, instructions, approvals, and run history." />
      {workflowMessage && <div className="profileAuthNotice">{workflowMessage}</div>}
      <div className="workflowShell">
        <div className="savedWorkflowList">
          {session?.user ? (
            <>
              {loadingSavedWorkflows && <div className="savedWorkflow"><strong>Loading saved workflows...</strong><span>Postgres profile</span></div>}
              {!loadingSavedWorkflows && visibleWorkflows.length === 0 && (
                <div className="savedWorkflow">
                  <strong>No saved workflows yet.</strong>
                  <span>Save the Job Search Automation workflow to begin.</span>
                </div>
              )}
              {visibleWorkflows.map((workflow, index) => (
                <button className={index === 0 ? "savedWorkflow active" : "savedWorkflow"} key={workflow.id}>
                  <strong>{workflow.name}</strong>
                  <span>{workflow.status} - {workflow.workflowAgents.length} agents</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="profileAuthNotice compactNotice">Sign in to save workflows. Mock workflows remain available for demo exploration.</div>
              {["Job Search Automation", "Research Brief Generator", "Coding Review Stack"].map((name, index) => (
                <button className={index === 0 ? "savedWorkflow active" : "savedWorkflow"} key={name}>
                  <strong>{name}</strong>
                  <span>{index === 0 ? "Active demo" : index === 1 ? "Ready demo" : "Paused demo"}</span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="card workflowDetail">
          <div className="panelHeader">
            <span>Detailed workflow</span>
            <strong>Job Search Automation</strong>
          </div>
          <div className="detailGrid">
            <DetailBlock label="Goal" value="Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval." />
            <DetailBlock label="Agent stack" value="Job Discovery -> Company Research -> Resume Tailoring -> Outreach Draft" />
            <DetailBlock label="MCP access" value="Search, Gmail draft-only, Docs / Notion" />
            <DetailBlock label="Memory partitions" value="Job Search Memory, Resume Memory, Research Memory" />
            <DetailBlock label="Budget" value="$5/week, $1.50 max per run" />
            <DetailBlock label="Saved instructions" value="Never send email or apply to jobs without explicit user approval." />
            <DetailBlock label="Runtime mode" value="AgentDock Sandbox Mode" />
          </div>
          <RuntimeModeSection context="workflow" />
          <RouteView />
          <div className="tableWrap platformTable">
            <table>
              <thead><tr><th>Agent</th><th>Allowed</th><th>Approval required</th><th>Blocked</th></tr></thead>
              <tbody>
                <tr><td>Job Discovery</td><td>Search, write tasks</td><td>None</td><td>Apply to jobs</td></tr>
                <tr><td>Resume Tailoring</td><td>Read resume memory</td><td>Create draft</td><td>Overwrite source</td></tr>
                <tr><td>Outreach Draft</td><td>Create Gmail drafts</td><td>Send review</td><td>Send email</td></tr>
              </tbody>
            </table>
          </div>
          <div className="runHistory">
            <span>Run history</span>
            {runHistory.slice(0, 4).map((run) => (
              <p key={run}>{run}</p>
            ))}
          </div>
          <div className="heroActions">
            <button className="primaryButton" onClick={onRun}>Run</button>
            <button className="secondaryButton" onClick={saveWorkflowToProfile} disabled={savingWorkflow}>
              {savingWorkflow ? "Saving..." : "Save workflow"}
            </button>
            <button className="secondaryButton">Edit Stack</button>
            <button className="secondaryButton">Edit Permissions</button>
            <button className="secondaryButton">Pause</button>
            <button className="secondaryButton" onClick={onOpenActivity}>View Logs</button>
          </div>
        </div>
      </div>
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
      <PageHeader eyebrow="Policy Profile" title="Personal defaults for approvals, agents, memory, data, and spend." copy="This page makes the user policy model visible before any agent receives tools, memory, or credentials." />
      {session?.user ? (
        <div className="profileAuthNotice">Signed in as {profileName || profileEmail}</div>
      ) : (
        <div className="profileAuthNotice">Sign in to save workflows, memory partitions, credentials, and logs to your AgentDock profile.</div>
      )}
      <div className="profileGrid">
        <Card title="Identity basics" meta="User">
          <DetailBlock label="Name" value={profileName ?? "Not signed in"} />
          <DetailBlock label="Email" value={profileEmail ?? "Not signed in"} />
          <DetailBlock label="Workspace" value="Personal demo workspace" />
        </Card>
        <Card title="Global approval rules" meta="High trust">
          {["Email sends require approval", "Payments are blocked by default", "External sharing requires approval", "Restricted memory always approval-gated"].map((rule) => <div className="approvalItem" key={rule}>{rule}</div>)}
        </Card>
        <Card title="Default agents" meta={defaultAgent}>
          <DetailBlock label="Discovery" value="Job Discovery Agent" />
          <DetailBlock label="Research" value="Company Research Agent" />
          <DetailBlock label="Documents" value="Resume Tailoring Agent" />
        </Card>
        <Card title="Model/provider preferences" meta="Cross-model">
          <DetailBlock label="Default model provider" value="OpenAI for workflow planning" />
          <DetailBlock label="Research provider" value="Claude" />
          <DetailBlock label="Outreach provider" value="Gemini" />
        </Card>
        <Card title="Budget defaults" meta="$5/week">
          <DetailBlock label="Weekly workflow cap" value="$5.00" />
          <DetailBlock label="Max run budget" value="$1.50" />
          <DetailBlock label="Premium model policy" value="Allowed within cap" />
        </Card>
        <Card title="Data-sharing rules" meta="Conservative">
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
      <PageHeader eyebrow="Keys & Billing" title="Credential Gateway for scoped, revocable access." copy="Agents never receive your raw provider keys. AgentDock issues scoped, revocable credentials that route through the policy gateway." />
      <div className="providerGrid">
        {["OpenAI", "Anthropic", "Gemini", "OpenRouter", "Google Workspace", "GitHub", "Stripe later"].map((provider) => (
          <div className="providerCard" key={provider}>
            <strong>{provider}</strong>
            <span>{provider === "Stripe later" ? "Planned" : "Connected"}</span>
          </div>
        ))}
      </div>
      <Card title="Platform-managed scoped credentials" meta="No raw keys exposed">
        <div className="tableWrap platformTable">
          <table>
            <thead><tr><th>Provider</th><th>Agent</th><th>Workflow</th><th>Scope</th><th>Expiry</th><th>Status</th></tr></thead>
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
        <Card title="Spend caps by workflow" meta="Policy enforced">
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
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Activity" title="Full audit timeline for agents, memory, credentials, MCPs, and policy." copy="Every entry is explainable by actor, workflow, tool, permission, memory partition, cost, and decision." />
      <div className="filterBar">
        {["event type", "agent", "workflow", "MCP/tool", "permission used", "memory partition", "cost", "decision"].map((filter) => <span key={filter}>{filter}</span>)}
      </div>
      <div className="activityTimeline fullTimeline">
        {events.map((event, index) => (
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
  const stack = ["A2UI Control Plane", "Orchestration Agent", "Policy Engine", "Memory Firewall + Credential Gateway", "AgentDock Runtime / Sandbox", "A2A Router", "Agents", "MCP Gateway", "Tools / Models / Apps"];
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
  const activePartition = memoryPartitions.find((partition) => partition.name === selectedMemory) ?? memoryPartitions[1];
  return (
    <section className="memorySection">
      <div className="memoryFirewallCard">
        <div>
          <p className="eyebrow">Memory Firewall</p>
          <h3>Agents only receive the context they need.</h3>
          <p>AgentDock partitions memory by workflow, sensitivity, and permission so one agent cannot leak or reuse unrelated context.</p>
        </div>
        <div className="dbStatus">
          <span>Database mode</span>
          <strong>Postgres-ready, mock-backed UI</strong>
          <p>Connect `DATABASE_URL` when ready. The demo remains safe without a live database.</p>
        </div>
      </div>
      <div className="memoryLayout">
        <div className="card">
          <div className="panelHeader"><span>Memory partitions</span><strong>{memoryPartitions.length} partitions</strong></div>
          <div className="memoryTable">
            {memoryPartitions.map((partition) => (
              <button className={`memoryRow ${partition.name === activePartition.name ? "selected" : ""}`} key={partition.name} onClick={() => onSelectMemory(partition.name)}>
                <div><strong>{partition.name}</strong><span>{partition.description}</span></div>
                <span className={`sensitivityBadge ${partition.sensitivity}`}>{partition.sensitivity}</span>
                <span>{partition.access}</span>
                <span>{partition.permissionLevel}</span>
                <span className="rowActions">Edit / Revoke</span>
              </button>
            ))}
          </div>
        </div>
        <aside className="card memoryDetail">
          <div className="panelHeader"><span>Memory Access detail</span><strong>{activePartition.name}</strong></div>
          <div className="detailStack">
            <DetailBlock label="Connected workflow" value={activePartition.workflow} />
            <DetailBlock label="Allowed agents" value={activePartition.allowedAgents.length ? activePartition.allowedAgents.join(", ") : "None by default"} />
            <DetailBlock label="Blocked agents" value={activePartition.blockedAgents.join(", ")} />
          </div>
          <div className="permissionList">
            <span>Permissions</span>
            {activePartition.permissions.map((permission) => <p key={permission}>{permission}</p>)}
          </div>
          <div className="actionRow detailActions">
            <button className="secondaryButton smallButton">Edit policy</button>
            <button className="revokeButton">Revoke access</button>
          </div>
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

  if (tab === "MCPs / Tools") {
    return mcpTools.map((tool) => ({
      id: `palette-mcp-${tool.name.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`,
      name: tool.name === "Gmail draft-only MCP" ? "Gmail Draft MCP" : tool.name,
      type: "mcp",
      category: "MCP / Tool",
      riskLevel: tool.risk,
      permissions: tool.permission,
      memoryAccess: "No memory unless workflow grants context",
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
        <button className="secondaryButton smallButton">Install workflow</button>
      </div>
      <h3>{workflow.name}</h3>
      <div className="agentStats expanded">
        <Metric label="Included agents" value={workflow.agents} />
        <Metric label="Required MCPs" value={workflow.mcps} />
        <Metric label="Memory partitions" value={workflow.memory} />
        <Metric label="Default permissions" value={workflow.permissions} />
        <Metric label="Budget recommendation" value={workflow.budget} />
      </div>
    </article>
  );
}
