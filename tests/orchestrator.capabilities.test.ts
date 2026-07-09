import { describe, expect, it } from "vitest";

import {
  missingCapabilities, requiredCapabilities, toolCapabilities, ensureSendGate
} from "../lib/orchestrator/capabilities";
import { serializeSnapshot } from "../lib/orchestrator/prompt";
import { resolvePlan } from "../lib/orchestrator/resolve";
import type { ResolvedFlow, ResolvedTool } from "../lib/orchestrator/resolve";
import type { CatalogSnapshot, CatalogSnapshotTool, FlowPlan } from "../lib/orchestrator/schema";

// A generic mock catalog of 24 tools built from data alone — ZERO per-tool code.
// Capability tags must derive purely from canonical identity + Chunk-16 flags.
function mockTool(i: number, serverKey: string, toolName: string, opts: Partial<CatalogSnapshotTool> = {}): CatalogSnapshotTool {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    key: `${serverKey}:${toolName}`,
    serverName: `${serverKey} ${toolName}`,
    displayName: `${serverKey} ${toolName}`,
    description: `${toolName} on ${serverKey}`,
    riskLevel: "medium",
    verificationStatus: "verified",
    recommendedPermission: "read_only",
    isExternalSend: false,
    toolNames: [toolName],
    ...opts
  };
}

const BIG_CATALOG: CatalogSnapshot = {
  agents: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Agent", category: "c", description: "d" }],
  tools: [
    mockTool(1, "search", "web_search"),
    mockTool(2, "docs", "search_documents"),
    mockTool(3, "github", "find_issues"),
    mockTool(4, "crm", "lookup_contact"),
    mockTool(5, "wiki", "query_pages"),
    mockTool(6, "files", "list_files"),
    mockTool(7, "news", "fetch_headlines"),
    mockTool(8, "gmail", "create_draft", { recommendedPermission: "draft_only" }),
    mockTool(9, "docs", "compose_summary", { recommendedPermission: "draft_only" }),
    mockTool(10, "gmail", "send_email", { isExternalSend: true, recommendedPermission: "approval_required" }),
    mockTool(11, "slack", "send_message", { isExternalSend: true, recommendedPermission: "approval_required" }),
    mockTool(12, "sms", "send_text", { isExternalSend: true, recommendedPermission: "approval_required" }),
    mockTool(13, "calendar", "read_availability"),
    mockTool(14, "calendar", "draft_event", { recommendedPermission: "draft_only" }),
    mockTool(15, "stripe", "read_usage"),
    mockTool(16, "stripe", "create_payment", { isExternalSend: true, riskLevel: "restricted", recommendedPermission: "blocked" }),
    mockTool(17, "jira", "find_tickets"),
    mockTool(18, "jira", "draft_comment", { recommendedPermission: "draft_only" }),
    mockTool(19, "notion", "search_notes"),
    mockTool(20, "notion", "compose_page", { recommendedPermission: "draft_only" }),
    mockTool(21, "weather", "read_forecast"),
    mockTool(22, "translate", "query_translation"),
    mockTool(23, "maps", "lookup_route"),
    mockTool(24, "hn", "fetch_top_stories")
  ],
  memory: [],
  policy: { weeklyBudgetCents: 500, maxRunBudgetCents: 150, approvalMode: "approval_gated" }
};

function planWith(tools: ResolvedTool[], gates = 0): ResolvedFlow {
  return {
    name: "F", goal: "Goal long enough.",
    agents: [{ agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", agentName: "Agent", role: "does things", order: 1, rationale: "why not" }],
    tools,
    memoryAttachments: [],
    approvalGates: Array.from({ length: gates }, (_, i) => ({ afterAgentOrder: 1, trigger: `gate ${i}`, actionType: "email_send" })),
    estimatedBudgetCents: 100, risks: []
  };
}

function asResolved(t: CatalogSnapshotTool): ResolvedTool {
  return {
    key: t.key as string, serverName: t.serverName, displayName: t.displayName, mcpServerId: t.id,
    requestedPermission: t.recommendedPermission, recommendedPermission: t.recommendedPermission,
    riskLevel: t.riskLevel, verificationStatus: t.verificationStatus, isExternalSend: t.isExternalSend, rationale: "picked"
  };
}

describe("toolCapabilities — derived from canonical identity + Chunk-16 flags, zero per-tool code", () => {
  it("tags every send tool via isExternalSend, every search-shaped identity as search, drafts as draft", () => {
    const caps = new Map(BIG_CATALOG.tools.map((t) => [t.key, toolCapabilities(t)]));
    // All three send tools tagged send — driven by the data flag.
    expect(caps.get("gmail:send_email")).toContain("send");
    expect(caps.get("slack:send_message")).toContain("send");
    expect(caps.get("sms:send_text")).toContain("send");
    expect(caps.get("stripe:create_payment")).toContain("send");
    // Search-shaped identities across 8+ different servers.
    for (const key of ["search:web_search", "docs:search_documents", "github:find_issues", "crm:lookup_contact", "wiki:query_pages", "files:list_files", "news:fetch_headlines", "notion:search_notes"]) {
      expect(caps.get(key)).toContain("search");
    }
    // Draft-shaped identities.
    for (const key of ["gmail:create_draft", "docs:compose_summary", "calendar:draft_event", "jira:draft_comment", "notion:compose_page"]) {
      expect(caps.get(key)).toContain("draft");
    }
    // A send tool is never also tagged search.
    expect(caps.get("gmail:send_email")).not.toContain("search");
    // Metadata-only rows have no capabilities.
    expect(toolCapabilities({ key: null, isExternalSend: false, recommendedPermission: "read_only" })).toEqual([]);
  });
});

describe("requiredCapabilities — derived from the goal", () => {
  it("research goals require search; send goals require send; draft-only goals require draft (never send)", () => {
    expect(requiredCapabilities("Research Vietnamese caterpillars and email me a summary")).toEqual(["search", "send"]);
    expect(requiredCapabilities("Draft an outreach email about our launch")).toEqual(["draft"]);
    // Memory-only summarize goals stay plannable with NO tools — summarize is
    // auto-attach territory (broad regex), never a hard search requirement.
    expect(requiredCapabilities("Summarize my meeting notes")).toEqual([]);
    expect(requiredCapabilities("Send the weekly update to the team")).toEqual(["send"]);
    expect(requiredCapabilities("Tell me a joke")).toEqual([]);
  });
});

describe("missingCapabilities — generic over a 24-tool catalog", () => {
  it("a resolved plan carrying the right tools has no gaps", () => {
    const plan = planWith([asResolved(BIG_CATALOG.tools[0]), asResolved(BIG_CATALOG.tools[9])]); // web_search + send_email
    expect(missingCapabilities(plan, BIG_CATALOG, ["search", "send"])).toEqual([]);
  });

  it("a missing-but-available capability lists real candidates for the re-plan", () => {
    const plan = planWith([asResolved(BIG_CATALOG.tools[0])]); // search only
    const gaps = missingCapabilities(plan, BIG_CATALOG, ["search", "send"]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].capability).toBe("send");
    expect(gaps[0].availableInCatalog).toBe(true);
    expect(gaps[0].candidates).toContain("gmail:send_email");
    expect(gaps[0].candidates).toContain("slack:send_message");
  });

  it("an unavailable capability yields the actionable connect-one error", () => {
    const noSend: CatalogSnapshot = { ...BIG_CATALOG, tools: BIG_CATALOG.tools.filter((t) => !t.isExternalSend) };
    const plan = planWith([asResolved(noSend.tools[0])]);
    const gaps = missingCapabilities(plan, noSend, ["send"]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].availableInCatalog).toBe(false);
    expect(gaps[0].reason).toContain("connect one");
  });
});

describe("ensureSendGate — Rule 6 validated, not just suggested", () => {
  it("auto-adds an approval gate (with a visible warning) when a send tool has none", () => {
    const plan = planWith([asResolved(BIG_CATALOG.tools[9])], 0); // send_email, no gate
    const warnings: string[] = [];
    ensureSendGate(plan, warnings);
    expect(plan.approvalGates).toHaveLength(1);
    expect(plan.approvalGates[0].afterAgentOrder).toBe(1);
    expect(warnings.some((w) => w.includes("Approval gate auto-added"))).toBe(true);
  });

  it("leaves plans without send tools, or with existing gates, untouched", () => {
    const noSend = planWith([asResolved(BIG_CATALOG.tools[0])], 0);
    const w1: string[] = [];
    ensureSendGate(noSend, w1);
    expect(noSend.approvalGates).toHaveLength(0);

    const gated = planWith([asResolved(BIG_CATALOG.tools[9])], 1);
    const w2: string[] = [];
    ensureSendGate(gated, w2);
    expect(gated.approvalGates).toHaveLength(1);
    expect(w2).toEqual([]);
  });
});

describe("scale rehearsal — 34-tool catalog, id-based selection survives growth", () => {
  // Pad the catalog past 30 tools with generic entries — still zero per-tool code.
  const PADDED: CatalogSnapshot = {
    ...BIG_CATALOG,
    tools: [
      ...BIG_CATALOG.tools,
      ...Array.from({ length: 10 }, (_, i) =>
        mockTool(100 + i, `srv${i}`, i % 2 === 0 ? `search_records_${i}` : `draft_note_${i}`, i % 2 === 1 ? { recommendedPermission: "draft_only" } : {}))
    ]
  };

  it("the prompt enumerates every canonical key; a plan referencing 5 keys resolves 100%", () => {
    expect(PADDED.tools.length).toBeGreaterThanOrEqual(34);
    const serialized = serializeSnapshot(PADDED);
    for (const t of PADDED.tools) expect(serialized).toContain(`key=${t.key}`);

    const plan: FlowPlan = {
      name: "Scale flow", goal: "A goal exercising a large catalog.",
      agents: [{ agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "does many things", order: 1, rationale: "scale check" }],
      tools: [
        { key: "search:web_search", requestedPermission: "read_only", rationale: "search" },
        { key: "gmail:send_email", requestedPermission: "approval_required", rationale: "send" },
        { key: "srv0:search_records_0", requestedPermission: "read_only", rationale: "records" },
        { key: "srv3:draft_note_3", requestedPermission: "draft_only", rationale: "note" },
        { key: "notion:search_notes", requestedPermission: "read_only", rationale: "notes" }
      ],
      memoryAttachments: [], approvalGates: [], estimatedBudgetCents: 100, risks: []
    };
    const { plan: resolved, failures } = resolvePlan(plan, PADDED);
    expect(failures).toEqual([]);
    expect(resolved.tools).toHaveLength(5);
    // Capability validation still exact over the padded catalog.
    expect(missingCapabilities(resolved, PADDED, ["search", "send", "draft"])).toEqual([]);
  });
});
