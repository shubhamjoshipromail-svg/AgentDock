import { describe, expect, it } from "vitest";

import { flowPlanSchema, permissionRank } from "../lib/orchestrator/schema";

const validPlan = {
  name: "Research and outreach",
  goal: "Find AI roles, research companies, and draft outreach for approval.",
  agents: [
    { agentName: "Job Discovery Agent", role: "Find roles", order: 1, rationale: "Surfaces high-fit roles." },
    { agentName: "Outreach Draft Agent", role: "Draft outreach", order: 2, rationale: "Writes drafts only." }
  ],
  tools: [
    { serverName: "Gmail Draft MCP", requestedPermission: "draft_only", rationale: "Draft emails for review." }
  ],
  memoryAttachments: [
    { partitionName: "Job Search Memory", access: "read_write", rationale: "Persist research notes." }
  ],
  approvalGates: [
    { afterAgentOrder: 2, trigger: "Before any email is sent", actionType: "send_email" }
  ],
  estimatedBudgetCents: 500,
  risks: [{ level: "medium", description: "Drafts could contain wrong contact details." }]
};

describe("flowPlanSchema", () => {
  it("parses a well-formed plan", () => {
    const result = flowPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it("defaults omitted optional collections to empty arrays", () => {
    const { tools, memoryAttachments, approvalGates, risks, ...rest } = validPlan;
    void tools; void memoryAttachments; void approvalGates; void risks;
    const result = flowPlanSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toEqual([]);
      expect(result.data.risks).toEqual([]);
    }
  });

  it("rejects an invalid permission enum", () => {
    const bad = { ...validPlan, tools: [{ serverName: "X", requestedPermission: "full_access", rationale: "nope" }] };
    expect(flowPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-integer / out-of-range agent order", () => {
    const bad = { ...validPlan, agents: [{ agentName: "A", role: "Role", order: 0, rationale: "low" }] };
    expect(flowPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects more than 8 agents", () => {
    const bad = {
      ...validPlan,
      agents: Array.from({ length: 9 }, (_, i) => ({ agentName: `A${i}`, role: "Role", order: i + 1, rationale: "ok reason" }))
    };
    expect(flowPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects zero agents", () => {
    expect(flowPlanSchema.safeParse({ ...validPlan, agents: [] }).success).toBe(false);
  });

  it("rejects a budget over the cap", () => {
    expect(flowPlanSchema.safeParse({ ...validPlan, estimatedBudgetCents: 100001 }).success).toBe(false);
  });

  it("rejects an invalid memory access value", () => {
    const bad = { ...validPlan, memoryAttachments: [{ partitionName: "M", access: "delete", rationale: "no" }] };
    expect(flowPlanSchema.safeParse(bad).success).toBe(false);
  });
});

describe("permissionRank", () => {
  it("orders permissions from least to most strict", () => {
    expect(permissionRank("read_only")).toBeLessThan(permissionRank("draft_only"));
    expect(permissionRank("draft_only")).toBeLessThan(permissionRank("approval_required"));
    expect(permissionRank("approval_required")).toBeLessThan(permissionRank("blocked"));
  });
});
