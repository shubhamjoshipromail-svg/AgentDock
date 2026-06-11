import type { McpDefaultPermission, McpRiskLevel } from "@prisma/client";

export type CuratedMcpServer = {
  name: string;
  displayName: string;
  description: string;
  registrySource: string;
  registryId: string;
  category: string;
  riskLevel: McpRiskLevel;
  verified: boolean;
  packageName?: string;
  packageRegistry?: string;
  repositoryUrl?: string;
  homepageUrl?: string;
  version?: string;
  installCommand?: string;
  recommendedPermission: McpDefaultPermission;
  tools: {
    name: string;
    description: string;
    riskLevel: McpRiskLevel;
  }[];
};

export const curatedMcpServers: CuratedMcpServer[] = [
  {
    name: "search-mcp",
    displayName: "Search MCP",
    description: "Public web discovery for research and market monitoring workflows.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:search-mcp",
    category: "Public info",
    riskLevel: "low",
    verified: true,
    recommendedPermission: "read_only",
    tools: [
      { name: "search_web", description: "Search public web results.", riskLevel: "low" },
      { name: "summarize_result", description: "Summarize public pages into workflow notes.", riskLevel: "low" }
    ]
  },
  {
    name: "github-mcp",
    displayName: "GitHub MCP",
    description: "Repository metadata and draft-only code review workflows. Writes require approval.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:github-mcp",
    category: "Developer tools",
    riskLevel: "medium",
    verified: true,
    recommendedPermission: "approval_required",
    tools: [
      { name: "read_repository", description: "Read repository files and metadata.", riskLevel: "medium" },
      { name: "draft_pr_comment", description: "Draft pull request comments without posting.", riskLevel: "medium" }
    ]
  },
  {
    name: "gmail-draft-mcp",
    displayName: "Gmail Draft MCP",
    description: "Creates email drafts only. Sending email is blocked unless explicitly approved later.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:gmail-draft-mcp",
    category: "Communications",
    riskLevel: "high",
    verified: true,
    recommendedPermission: "draft_only",
    tools: [
      { name: "create_draft", description: "Create a draft email for human review.", riskLevel: "high" },
      { name: "send_email", description: "Blocked action in this prototype.", riskLevel: "restricted" }
    ]
  },
  {
    name: "google-calendar-mcp",
    displayName: "Google Calendar MCP",
    description: "Calendar availability metadata. Creating or changing events requires approval.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:google-calendar-mcp",
    category: "Scheduling",
    riskLevel: "medium",
    verified: true,
    recommendedPermission: "approval_required",
    tools: [
      { name: "read_availability", description: "Read calendar availability metadata.", riskLevel: "medium" },
      { name: "draft_event", description: "Draft calendar event changes.", riskLevel: "medium" }
    ]
  },
  {
    name: "docs-notion-mcp",
    displayName: "Docs / Notion MCP",
    description: "Draft documents, notes, and research briefs in workspace-scoped surfaces.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:docs-notion-mcp",
    category: "Documents",
    riskLevel: "medium",
    verified: true,
    recommendedPermission: "approval_required",
    tools: [
      { name: "create_note", description: "Create draft notes.", riskLevel: "medium" },
      { name: "update_doc", description: "Draft document updates for approval.", riskLevel: "medium" }
    ]
  },
  {
    name: "stripe-mcp-later",
    displayName: "Stripe MCP later",
    description: "Planned billing and payment metadata. Payment actions stay restricted.",
    registrySource: "agentdock-curated-fallback",
    registryId: "agentdock:stripe-mcp-later",
    category: "Payments",
    riskLevel: "restricted",
    verified: false,
    recommendedPermission: "blocked",
    tools: [
      { name: "read_usage", description: "Read billing usage metadata.", riskLevel: "high" },
      { name: "create_payment", description: "Restricted payment action.", riskLevel: "restricted" }
    ]
  }
];

export function defaultPermissionForRisk(riskLevel: McpRiskLevel): McpDefaultPermission {
  if (riskLevel === "low") return "read_only";
  if (riskLevel === "high") return "draft_only";
  if (riskLevel === "restricted") return "blocked";
  return "approval_required";
}

export function grantTemplateForPermission(permission: McpDefaultPermission, riskLevel: McpRiskLevel) {
  if (permission === "read_only") {
    return {
      canRead: true,
      canWrite: false,
      canExecute: false,
      canDelete: false,
      requiresApproval: false,
      allowedActions: ["read_public_metadata", "summarize_results"],
      blockedActions: ["write", "delete", "send", "payment"]
    };
  }

  if (permission === "draft_only") {
    return {
      canRead: true,
      canWrite: riskLevel === "high" ? false : true,
      canExecute: false,
      canDelete: false,
      requiresApproval: true,
      allowedActions: ["create_draft", "read_scoped_metadata"],
      blockedActions: ["send", "delete", "external_share", "payment"]
    };
  }

  if (permission === "blocked") {
    return {
      canRead: false,
      canWrite: false,
      canExecute: false,
      canDelete: false,
      requiresApproval: true,
      allowedActions: [],
      blockedActions: ["read", "write", "execute", "delete", "payment"]
    };
  }

  return {
    canRead: true,
    canWrite: false,
    canExecute: false,
    canDelete: false,
    requiresApproval: true,
    allowedActions: ["read_scoped_metadata", "draft_change"],
    blockedActions: ["execute_without_approval", "delete", "send", "payment"]
  };
}
