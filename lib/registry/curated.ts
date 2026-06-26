// Curated AgentDock-verified servers in the normalized shape.
// Content is canonical here; lib/mcp-catalog.ts keeps a re-export for
// backward-compat with the old sync route (will be replaced in Phase B).
import type { McpRiskLevel } from "@prisma/client";

import type { NormalizedMcpServer } from "./types";

const verified = "verified" as const;

export const curatedServers: NormalizedMcpServer[] = [
  {
    name: "search-mcp",
    displayName: "Search MCP",
    description: "Public web discovery for research and market monitoring workflows.",
    registrySource: "agentdock-curated",
    registryId: "agentdock:search-mcp",
    category: "Public info",
    riskLevel: "low" as McpRiskLevel,
    verificationStatus: verified,
    recommendedPermission: "read_only",
    // Real, executable MCP identity: routes to the first-party `search` stdio
    // server's `web_search` tool via the single execution path. Without these
    // columns the row is a dead catalog entry (no executor) and research silently
    // returns "[unavailable]".
    mcpServerKey: "search",
    mcpToolName: "web_search",
    isExternalSend: false,
    tools: [
      { name: "web_search", description: "Search the public web for a query and return result snippets.", riskLevel: "low" }
    ]
  },
  {
    name: "github-mcp",
    displayName: "GitHub MCP",
    description: "Repository metadata and draft-only code review workflows. Writes require approval.",
    registrySource: "agentdock-curated",
    registryId: "agentdock:github-mcp",
    category: "Developer tools",
    riskLevel: "medium" as McpRiskLevel,
    verificationStatus: verified,
    recommendedPermission: "approval_required",
    tools: [
      { name: "read_repository", description: "Read repository files and metadata.", riskLevel: "medium" },
      { name: "draft_pr_comment", description: "Draft pull request comments without posting.", riskLevel: "medium" }
    ]
  },
  // Gmail tool rows (create_draft + send_email) are seeded under the canonical
  // "discovered" identity in prisma/seed.js so they converge with the live
  // connect→discover flow. They are intentionally NOT duplicated here as curated
  // catalog entries — that produced two rows per tool (the Chunk-15 dedupe).
  {
    name: "google-calendar-mcp",
    displayName: "Google Calendar MCP",
    description: "Calendar availability metadata. Creating or changing events requires approval.",
    registrySource: "agentdock-curated",
    registryId: "agentdock:google-calendar-mcp",
    category: "Scheduling",
    riskLevel: "medium" as McpRiskLevel,
    verificationStatus: verified,
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
    registrySource: "agentdock-curated",
    registryId: "agentdock:docs-notion-mcp",
    category: "Documents",
    riskLevel: "medium" as McpRiskLevel,
    verificationStatus: verified,
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
    registrySource: "agentdock-curated",
    registryId: "agentdock:stripe-mcp-later",
    category: "Payments",
    riskLevel: "restricted" as McpRiskLevel,
    verificationStatus: "unverified",
    recommendedPermission: "blocked",
    tools: [
      { name: "read_usage", description: "Read billing usage metadata.", riskLevel: "high" },
      { name: "create_payment", description: "Restricted payment action.", riskLevel: "restricted" }
    ]
  }
];
