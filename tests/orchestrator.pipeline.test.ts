import { describe, expect, it } from "vitest";

import { clampPermissions } from "../lib/orchestrator/clamp";
import { planToSaveInput } from "../lib/orchestrator/convert";
import { resolvePlan } from "../lib/orchestrator/resolve";
import type { ResolvedFlow, ResolvedTool } from "../lib/orchestrator/resolve";
import type { CatalogSnapshot, FlowPlan } from "../lib/orchestrator/schema";
import { createFlowSchema } from "../lib/validation/schemas";

const snapshot: CatalogSnapshot = {
  agents: [
    { name: "Job Discovery Agent", category: "Search", description: "Finds roles." },
    { name: "Outreach Draft Agent", category: "Comms", description: "Drafts outreach." }
  ],
  tools: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      serverName: "Search MCP", displayName: "Search MCP", description: "Public web search.",
      riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only", toolNames: ["search_web"]
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      serverName: "Gmail Draft MCP", displayName: "Gmail Draft MCP", description: "Email drafts.",
      riskLevel: "high", verificationStatus: "verified", recommendedPermission: "draft_only", toolNames: ["create_draft"]
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      serverName: "Some External MCP", displayName: "Some External MCP", description: "Third-party tool.",
      riskLevel: "medium", verificationStatus: "unverified", recommendedPermission: "approval_required", toolNames: []
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      serverName: "Stripe MCP later", displayName: "Stripe MCP later", description: "Payments.",
      riskLevel: "restricted", verificationStatus: "unverified", recommendedPermission: "blocked", toolNames: []
    }
  ],
  memory: [{ partitionName: "Job Search Memory", domain: "workflow", sensitivity: "medium" }],
  policy: { weeklyBudgetCents: 500, maxRunBudgetCents: 150, approvalMode: "approval_gated" }
};

describe("resolvePlan", () => {
  it("drops unresolvable references and records warnings", () => {
    const plan: FlowPlan = {
      name: "Test flow",
      goal: "A test goal that is long enough.",
      agents: [
        { agentName: "Job Discovery Agent", role: "Find roles", order: 1, rationale: "Finds roles." },
        { agentName: "Ghost Agent", role: "Nope", order: 2, rationale: "Not in catalog." }
      ],
      tools: [
        { serverName: "Search MCP", requestedPermission: "read_only", rationale: "Search." },
        { serverName: "Made Up MCP", requestedPermission: "read_only", rationale: "Hallucinated." }
      ],
      memoryAttachments: [
        { partitionName: "Job Search Memory", access: "read_write", rationale: "Notes." },
        { partitionName: "Fake Memory", access: "read", rationale: "Nope." }
      ],
      approvalGates: [],
      estimatedBudgetCents: 300,
      risks: []
    };

    const { plan: resolved, warnings } = resolvePlan(plan, snapshot);
    expect(resolved.agents).toHaveLength(1);
    expect(resolved.agents[0].agentName).toBe("Job Discovery Agent");
    expect(resolved.tools).toHaveLength(1);
    expect(resolved.memoryAttachments).toHaveLength(1);
    expect(warnings.some((w) => w.includes("Ghost Agent"))).toBe(true);
    expect(warnings.some((w) => w.includes("Made Up MCP"))).toBe(true);
    expect(warnings.some((w) => w.includes("Fake Memory"))).toBe(true);
  });

  it("re-normalizes agent order to contiguous 1..n preserving relative order", () => {
    const plan: FlowPlan = {
      name: "Order flow", goal: "Order test goal here.",
      agents: [
        { agentName: "Outreach Draft Agent", role: "Draft", order: 7, rationale: "Drafts later." },
        { agentName: "Job Discovery Agent", role: "Find", order: 3, rationale: "Finds first." }
      ],
      tools: [], memoryAttachments: [], approvalGates: [], estimatedBudgetCents: 100, risks: []
    };
    const { plan: resolved } = resolvePlan(plan, snapshot);
    expect(resolved.agents.map((a) => [a.agentName, a.order])).toEqual([
      ["Job Discovery Agent", 1],
      ["Outreach Draft Agent", 2]
    ]);
  });

  it("re-points an approval gate whose target agent was dropped", () => {
    const plan: FlowPlan = {
      name: "Gate flow", goal: "Gate test goal here.",
      agents: [{ agentName: "Job Discovery Agent", role: "Find", order: 1, rationale: "Finds." }],
      tools: [], memoryAttachments: [],
      approvalGates: [{ afterAgentOrder: 5, trigger: "Before send", actionType: "send_email" }],
      estimatedBudgetCents: 100, risks: []
    };
    const { plan: resolved, warnings } = resolvePlan(plan, snapshot);
    expect(resolved.approvalGates).toHaveLength(1);
    expect(resolved.approvalGates[0].afterAgentOrder).toBe(1);
    expect(warnings.some((w) => w.includes("Re-pointed approval gate"))).toBe(true);
  });
});

function resolvedTool(partial: Partial<ResolvedTool> & Pick<ResolvedTool, "requestedPermission">): ResolvedTool {
  return {
    serverName: "T", displayName: "T", mcpServerId: "00000000-0000-4000-8000-000000000000",
    recommendedPermission: "read_only", riskLevel: "low", verificationStatus: "verified", rationale: "because",
    ...partial
  };
}

function flowWithTools(tools: ResolvedTool[]): ResolvedFlow {
  return {
    name: "F", goal: "Goal long enough.", agents: [], tools,
    memoryAttachments: [], approvalGates: [], estimatedBudgetCents: 100, risks: []
  };
}

describe("clampPermissions", () => {
  it("leaves a request within the ceiling unchanged", () => {
    const { plan, warnings } = clampPermissions(flowWithTools([
      resolvedTool({ displayName: "Search MCP", requestedPermission: "read_only" })
    ]));
    expect(plan.tools[0].effectivePermission).toBe("read_only");
    expect(warnings).toHaveLength(0);
  });

  it("an unverified server can never end below approval_required, even if read_only is requested", () => {
    const { plan, warnings } = clampPermissions(flowWithTools([
      resolvedTool({
        displayName: "Some External MCP", requestedPermission: "read_only",
        recommendedPermission: "approval_required", riskLevel: "medium", verificationStatus: "unverified"
      })
    ]));
    expect(plan.tools[0].effectivePermission).toBe("approval_required");
    expect(plan.tools[0].ceiling).toBe("approval_required");
    expect(warnings[0]).toContain("read_only → approval_required");
  });

  it("a restricted server is always blocked", () => {
    const { plan } = clampPermissions(flowWithTools([
      resolvedTool({
        displayName: "Stripe MCP later", requestedPermission: "read_only",
        recommendedPermission: "blocked", riskLevel: "restricted", verificationStatus: "unverified"
      })
    ]));
    expect(plan.tools[0].effectivePermission).toBe("blocked");
  });

  it("clamps up to the server's recommended permission", () => {
    const { plan, warnings } = clampPermissions(flowWithTools([
      resolvedTool({
        displayName: "Gmail Draft MCP", requestedPermission: "read_only",
        recommendedPermission: "draft_only", riskLevel: "high", verificationStatus: "verified"
      })
    ]));
    expect(plan.tools[0].effectivePermission).toBe("draft_only");
    expect(warnings[0]).toContain("read_only → draft_only");
  });

  it("lets the model tighten below the ceiling without a warning", () => {
    const { plan, warnings } = clampPermissions(flowWithTools([
      resolvedTool({ displayName: "Search MCP", requestedPermission: "blocked" })
    ]));
    expect(plan.tools[0].effectivePermission).toBe("blocked");
    expect(warnings).toHaveLength(0);
  });
});

describe("planToSaveInput", () => {
  it("produces a payload the real create-workflow schema accepts", () => {
    const { plan } = clampPermissions(
      resolvePlan(
        {
          name: "Round trip", goal: "Round trip goal that is valid.",
          agents: [{ agentName: "Job Discovery Agent", role: "Find roles", order: 1, rationale: "Finds." }],
          tools: [{ serverName: "Some External MCP", requestedPermission: "read_only", rationale: "Use it." }],
          memoryAttachments: [{ partitionName: "Job Search Memory", access: "read_write", rationale: "Notes." }],
          approvalGates: [{ afterAgentOrder: 1, trigger: "Before send", actionType: "send_email" }],
          estimatedBudgetCents: 0, risks: []
        },
        snapshot
      ).plan
    );

    const payload = planToSaveInput(plan);
    const parsed = createFlowSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    // Budget 0 became a positive default; tool carries the clamped permission.
    expect(payload.weeklyBudgetCents).toBeGreaterThan(0);
    expect(payload.tools?.[0].defaultPermission).toBe("approval_required");
    expect(payload.approvalMode).toBe("approval_gated");
  });
});
