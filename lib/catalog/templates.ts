// The single place where the "Job Search Automation" demo template is defined.
// Everything job-search-specific that the backend or the explicit
// "Load Template" action needs lives here — nowhere else in app/api or lib.

export type FlowTemplateAgent = {
  agentName: string;
  roleInWorkflow: string;
  routeOrder: number;
  defaultMode: string;
};

export type FlowTemplate = {
  name: string;
  goal: string;
  weeklyBudgetCents: number;
  maxRunBudgetCents: number;
  approvalMode: "manual" | "approval_gated" | "autonomous_with_limits";
  agents: FlowTemplateAgent[];
};

export const starterFlowTemplate: FlowTemplate = {
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

export const flowTemplates: FlowTemplate[] = [starterFlowTemplate];

// Starter memory workspace created by POST /api/bootstrap.
export const starterMemoryPartitions = [
  { name: "Global Profile", type: "global", sensitivityLevel: "medium", description: "User-level preferences and durable profile facts.", defaultAccessPolicy: "approval_required", scopedToStarterFlow: false },
  { name: "Job Search Memory", type: "workflow", sensitivityLevel: "medium", description: "Roles, target companies, search criteria, and job-search preferences.", defaultAccessPolicy: "workflow_scoped", scopedToStarterFlow: true },
  { name: "Resume Memory", type: "workflow", sensitivityLevel: "high", description: "Resume source, approved bullets, and work-history context.", defaultAccessPolicy: "approval_required", scopedToStarterFlow: true },
  { name: "Research Memory", type: "workflow", sensitivityLevel: "medium", description: "Company briefs, recruiter notes, and opportunity research.", defaultAccessPolicy: "workflow_scoped", scopedToStarterFlow: true },
  { name: "Finance Memory", type: "domain", sensitivityLevel: "restricted", description: "Finance preferences and sensitive financial context.", defaultAccessPolicy: "blocked_by_default", scopedToStarterFlow: false },
  { name: "Health Memory", type: "domain", sensitivityLevel: "restricted", description: "Health-related context that agents cannot access by default.", defaultAccessPolicy: "blocked_by_default", scopedToStarterFlow: false },
  { name: "Travel Memory", type: "domain", sensitivityLevel: "high", description: "Location, itinerary, and travel preference context.", defaultAccessPolicy: "approval_required", scopedToStarterFlow: false }
] as const;

export const starterMemoryItems = [
  {
    partitionName: "Job Search Memory",
    title: "Target role pattern",
    content: "Prioritize AI agent infrastructure, control plane, and platform engineering roles.",
    sourceType: "user",
    sourceAgentName: null,
    sensitivityLevel: "medium",
    metadata: { tags: ["job-search", "preferences"], source: "bootstrap" }
  },
  {
    partitionName: "Resume Memory",
    title: "Approved resume positioning",
    content: "Position around agent platforms, orchestration, safety, and high-trust product systems.",
    sourceType: "workflow",
    sourceAgentName: null,
    sensitivityLevel: "high",
    metadata: { tags: ["resume", "approved"], source: "bootstrap" }
  },
  {
    partitionName: "Research Memory",
    title: "Company research preference",
    content: "Summaries should include product surface, hiring signals, leadership, and recent funding.",
    sourceType: "agent",
    sourceAgentName: "Company Research Agent",
    sensitivityLevel: "medium",
    metadata: { tags: ["research"], source: "bootstrap" }
  }
] as const;

export const starterMemoryGrants = [
  { partitionName: "Job Search Memory", agentName: "Job Discovery Agent", flags: { read: true, write: true } },
  { partitionName: "Job Search Memory", agentName: "Resume Tailoring Agent", flags: { read: true, write: true } },
  { partitionName: "Job Search Memory", agentName: "Company Research Agent", flags: { read: true, write: true } },
  { partitionName: "Job Search Memory", agentName: "Outreach Draft Agent", flags: { read: true, write: true, approval: true } },
  { partitionName: "Resume Memory", agentName: "Resume Tailoring Agent", flags: { read: true, write: true, edit: true, approval: true } },
  { partitionName: "Research Memory", agentName: "Company Research Agent", flags: { read: true, write: true } },
  { partitionName: "Research Memory", agentName: "Outreach Draft Agent", flags: { read: true } },
  { partitionName: "Finance Memory", agentName: "Finance Agent", flags: { approval: true } },
  { partitionName: "Health Memory", agentName: "Health Agent", flags: { approval: true } }
] as const;

export const starterMemoryLogs = [
  {
    partitionName: "Job Search Memory",
    agentName: "Resume Tailoring Agent",
    scopedToStarterFlow: true,
    action: "read",
    decision: "allowed",
    reason: "Resume Tailoring Agent read Job Search Memory within workflow grant."
  },
  {
    partitionName: "Health Memory",
    agentName: "Shopping Agent",
    scopedToStarterFlow: false,
    action: "read",
    decision: "blocked",
    reason: "Shopping Agent attempted to read Health Memory."
  }
] as const;
