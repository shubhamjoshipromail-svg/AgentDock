import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Mock the provider at the lib/llm boundary — no network, no keys. A queue of
// fake completions is shifted on each completeJson call.
const llmState = vi.hoisted(() => ({
  provider: null as null | {
    name: string;
    model: string;
    completeJson: (params: unknown) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costCents: number }>;
  },
  queue: [] as { text: string; inputTokens?: number; outputTokens?: number; costCents?: number }[],
  calls: 0
}));

vi.mock("../lib/llm", () => ({
  getProvider: () => llmState.provider
}));

const runProviderState = vi.hoisted(() => ({
  provider: null as null | {
    name: string;
    model: string;
    completeJson: (params: unknown) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costCents: number }>;
  }
}));

vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => runProviderState.provider)
}));

import { POST as planFlow } from "../app/api/flows/plan/route";

function makeProvider() {
  return {
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llmState.calls += 1;
      const next = llmState.queue.shift();
      if (!next) throw new Error("no queued completion");
      return {
        text: next.text,
        usage: { inputTokens: next.inputTokens ?? 1000, outputTokens: next.outputTokens ?? 500 },
        costCents: next.costCents ?? 2
      };
    })
  };
}

function planRequest(goal: string) {
  return new Request("http://localhost/api/flows/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal })
  });
}

const VALID_PLAN_JSON = JSON.stringify({
  name: "Research and outreach",
  goal: "Find AI roles and draft outreach.",
  agents: [{ agentName: "Job Discovery Agent", role: "Find roles", order: 1, rationale: "Surfaces roles." }],
  tools: [{ serverName: "Some External MCP", requestedPermission: "read_only", rationale: "Look things up." }],
  memoryAttachments: [{ partitionName: "Job Search Memory", access: "read_write", rationale: "Persist notes." }],
  approvalGates: [],
  estimatedBudgetCents: 300,
  risks: [{ level: "low", description: "Summaries may be stale." }]
});

async function seedCatalog(userId: string) {
  await prisma.agent.create({
    data: { userId, name: "Job Discovery Agent", category: "Search", provider: "AgentDock", verified: true, description: "Finds roles." }
  });
  await prisma.mcpServer.create({
    data: {
      name: "ext-mcp", displayName: "Some External MCP", description: "Third-party outreach and roles research tool.",
      registrySource: "mcp-official-registry", registryId: "ext/mcp",
      riskLevel: "medium", verificationStatus: "unverified", recommendedPermission: "approval_required",
      // Executable canonical identity (Chunk 19): metadata-only rows are refused
      // at resolve time, so a plannable tool must carry a discovered identity.
      mcpServerKey: "ext", mcpToolName: "do_thing"
    }
  });
  await prisma.memoryPartition.create({
    data: {
      userId, name: "Job Search Memory", type: "workflow", sensitivityLevel: "medium",
      description: "Notes.", defaultAccessPolicy: "workflow_scoped"
    }
  });
}

describe("POST /api/flows/plan", () => {
  beforeEach(async () => {
    await resetDatabase();
    llmState.provider = makeProvider();
    runProviderState.provider = null;
    llmState.queue = [];
    llmState.calls = 0;
    setCurrentUser(null);
  });

  it("401 when signed out", async () => {
    const res = await planFlow(planRequest("a goal here"));
    expect(res.status).toBe(401);
  });

  it("503 when no provider is configured", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    llmState.provider = null;
    const res = await planFlow(planRequest("plan something real"));
    expect(res.status).toBe(503);
  });

  it("happy path returns a clamped plan + meta and writes one ActivityLog row", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    llmState.queue = [{ text: VALID_PLAN_JSON, costCents: 3 }];

    const res = await planFlow(planRequest("Find AI roles and draft outreach for approval."));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.plan.agents).toHaveLength(1);
    expect(data.planMeta.costCents).toBe(3);
    expect(data.planMeta.provider).toBe("anthropic");
    // unverified server requested read_only -> clamped up to approval_required + warning
    expect(data.plan.tools[0].effectivePermission).toBe("approval_required");
    expect(data.warnings.some((w: string) => w.includes("approval_required"))).toBe(true);

    const logs = await prisma.activityLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].costCents).toBe(3);
    expect(logs[0].eventType).toBe("orchestration");
    // Privacy: goal text is never logged.
    expect(logs[0].title + logs[0].description).not.toContain("Find AI roles");
  });

  it("prefers the signed-in user's BYO provider key over the system env provider", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    runProviderState.provider = {
      ...makeProvider(),
      name: "openrouter",
      model: "openai/gpt-4.1"
    };
    llmState.queue = [{ text: VALID_PLAN_JSON, costCents: 2 }];

    const res = await planFlow(planRequest("Find roles using my own model key."));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.planMeta.provider).toBe("openrouter");
    expect(data.planMeta.model).toBe("openai/gpt-4.1");
  });

  it("a plan with one bad reference triggers exactly one feedback re-plan and then resolves", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    const badRef = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      tools: [{ key: "nonexistent:tool", requestedPermission: "read_only", rationale: "Hallucinated key." }]
    });
    llmState.queue = [
      { text: badRef, costCents: 2 },
      { text: VALID_PLAN_JSON, costCents: 2 } // corrected after failure feedback
    ];

    const res = await planFlow(planRequest("Plan outreach steps for the roles I already have."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(2); // exactly one re-plan
    const data = await res.json();
    expect(data.report.replanned).toBe(true);
    expect(data.report.failed).toEqual([]);
    expect(data.plan.tools).toHaveLength(1); // the corrected reference resolved
  });

  it("an unresolvable reference after the re-plan surfaces as a visible error — never a silent drop", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    const badRef = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      tools: [{ key: "nonexistent:tool", requestedPermission: "read_only", rationale: "Hallucinated key." }]
    });
    llmState.queue = [
      { text: badRef, costCents: 2 },
      { text: badRef, costCents: 2 } // the model repeats its mistake
    ];

    const res = await planFlow(planRequest("Plan outreach steps for the roles I already have."));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report.failed).toHaveLength(1);
    expect(data.report.failed[0]).toMatchObject({ kind: "tool", asked: "nonexistent:tool" });
    // Mirrored into warnings for older clients — visible either way.
    expect(data.warnings.some((w: string) => w.includes("nonexistent:tool"))).toBe(true);
  });

  it("research→send goal: a plan missing the send tool is re-planned to include it (capability validated server-side)", async () => {
    const user = await createTestUser();
    // This scenario presupposes the user has enabled real sending; a draft-only
    // user would (correctly) never be offered a send tool.
    await prisma.user.update({ where: { id: user.id }, data: { sendingEnabled: true } });
    setCurrentUser({ ...user, sendingEnabled: true });
    await seedCatalog(user.id);
    // Send- and search-capable tools exist in the catalog.
    await prisma.mcpServer.create({
      data: {
        name: "gmail-send-email", displayName: "Gmail Send", description: "Sends email for outreach and roles.",
        registrySource: "first-party", registryId: "agentdock:gmail:send_email",
        riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "approval_required",
        mcpServerKey: "gmail", mcpToolName: "send_email", isExternalSend: true
      }
    });
    await prisma.mcpServer.create({
      data: {
        name: "search-mcp", displayName: "Web Search", description: "Public web search for research.",
        registrySource: "first-party", registryId: "agentdock:search:web_search",
        riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only",
        mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false
      }
    });
    // First plan forgets the send tool; the corrected plan includes it.
    const noSend = VALID_PLAN_JSON; // has only the external read tool
    const withSend = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      tools: [
        { key: "ext:do_thing", requestedPermission: "read_only", rationale: "Look things up." },
        { key: "gmail:send_email", requestedPermission: "approval_required", rationale: "Send the summary." }
      ]
    });
    llmState.queue = [
      { text: noSend, costCents: 2 },
      { text: withSend, costCents: 2 }
    ];

    const res = await planFlow(planRequest("Research AI roles and outreach angles, then send me the summary by email."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(2); // capability gap triggered the one re-plan
    const data = await res.json();
    expect(data.report.failed).toEqual([]);
    expect(data.plan.tools.some((t: { key: string }) => t.key === "gmail:send_email")).toBe(true);
    // Rule 6 validated: a send plan always carries an approval gate.
    expect(data.plan.approvalGates.length).toBeGreaterThan(0);
  });

  it("a send goal with NO send-capable tool available yields the actionable connect-one error, not a broken flow", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id); // catalog has no send tool
    llmState.queue = [{ text: VALID_PLAN_JSON, costCents: 2 }];

    const res = await planFlow(planRequest("Research AI roles and outreach angles, then send me the summary by email."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(1); // nothing to re-plan toward — no wasted call
    const data = await res.json();
    const capFailure = data.report.failed.find((f: { asked: string }) => f.asked === "capability: send");
    expect(capFailure).toBeTruthy();
    expect(capFailure.reason).toContain("connect one");
  });

  it("research→draft-only goal: draft attached, send NEVER attached", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    await prisma.mcpServer.create({
      data: {
        name: "gmail-create-draft", displayName: "Gmail Draft", description: "Drafts outreach emails about roles.",
        registrySource: "first-party", registryId: "agentdock:gmail:create_draft",
        riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "draft_only",
        mcpServerKey: "gmail", mcpToolName: "create_draft", isExternalSend: false
      }
    });
    await prisma.mcpServer.create({
      data: {
        name: "gmail-send-email", displayName: "Gmail Send", description: "Sends outreach emails about roles.",
        registrySource: "first-party", registryId: "agentdock:gmail:send_email",
        riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "approval_required",
        mcpServerKey: "gmail", mcpToolName: "send_email", isExternalSend: true
      }
    });
    const draftPlan = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      tools: [{ key: "gmail:create_draft", requestedPermission: "draft_only", rationale: "Draft the outreach." }]
    });
    llmState.queue = [{ text: draftPlan, costCents: 2 }];

    const res = await planFlow(planRequest("Draft an outreach note about the roles I like."));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report.failed).toEqual([]);
    expect(data.plan.tools.some((t: { key: string }) => t.key === "gmail:create_draft")).toBe(true);
    // "Draft" never silently escalates to send.
    expect(data.plan.tools.some((t: { key: string }) => t.key === "gmail:send_email")).toBe(false);
  });

  it("summarize-memory-only goal: plannable with zero tools (no hard search requirement)", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    const memoryOnly = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      tools: []
    });
    llmState.queue = [{ text: memoryOnly, costCents: 2 }];

    const res = await planFlow(planRequest("Summarize my saved notes into a short brief."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(1); // no re-plan needed
    const data = await res.json();
    expect(data.report.failed).toEqual([]);
    expect(data.plan.agents).toHaveLength(1);
  });

  it("choose-then-act goal: search + send + approval gate all attached, resolving first try", async () => {
    const user = await createTestUser();
    // Presupposes real sending is enabled — a send goal for a draft-only user
    // is (correctly) offered no send tool.
    await prisma.user.update({ where: { id: user.id }, data: { sendingEnabled: true } });
    setCurrentUser({ ...user, sendingEnabled: true });
    await seedCatalog(user.id);
    await prisma.mcpServer.create({
      data: {
        name: "gmail-send-email", displayName: "Gmail Send", description: "Sends email for outreach and roles.",
        registrySource: "first-party", registryId: "agentdock:gmail:send_email",
        riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "approval_required",
        mcpServerKey: "gmail", mcpToolName: "send_email", isExternalSend: true
      }
    });
    await prisma.mcpServer.create({
      data: {
        name: "search-mcp", displayName: "Web Search", description: "Public web search for research.",
        registrySource: "first-party", registryId: "agentdock:search:web_search",
        riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only",
        mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false
      }
    });
    const chooseThenAct = JSON.stringify({
      ...JSON.parse(VALID_PLAN_JSON),
      agents: [
        { agentName: "Job Discovery Agent", role: "Research options and ask the user to choose one", order: 1, rationale: "Surfaces candidates and pauses for the user's pick." },
        { agentName: "Job Discovery Agent", role: "Send the chosen option by email", order: 2, rationale: "Acts only on the user's choice." }
      ],
      tools: [
        { key: "search:web_search", requestedPermission: "read_only", rationale: "Research the candidates." },
        { key: "gmail:send_email", requestedPermission: "approval_required", rationale: "Send the user's pick." }
      ],
      approvalGates: [{ afterAgentOrder: 2, trigger: "Before the chosen email is sent", actionType: "external_send" }]
    });
    llmState.queue = [{ text: chooseThenAct, costCents: 2 }];

    const res = await planFlow(planRequest("Research three outreach targets, ask me to choose one, then send my pick by email."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(1); // resolves by construction — no re-plan needed
    const data = await res.json();
    expect(data.report.failed).toEqual([]);
    expect(data.plan.tools.some((t: { key: string }) => t.key === "search:web_search")).toBe(true);
    expect(data.plan.tools.some((t: { key: string }) => t.key === "gmail:send_email")).toBe(true);
    // The choice never authorizes the consequential action — the send gate stands.
    expect(data.plan.approvalGates.length).toBeGreaterThan(0);
  });

  it("retries once on invalid-then-valid output and marks retried", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    llmState.queue = [
      { text: "not json at all", costCents: 1 },
      { text: VALID_PLAN_JSON, costCents: 2 }
    ];

    const res = await planFlow(planRequest("Plan a research flow please."));
    expect(res.status).toBe(200);
    expect(llmState.calls).toBe(2);

    const logs = await prisma.activityLog.findMany({ where: { userId: user.id } });
    expect(logs[0].costCents).toBe(3); // 1 + 2 across both calls
    expect((logs[0].metadata as { retried?: boolean }).retried).toBe(true);
  });

  it("returns 422 after two invalid outputs and still logs the cost", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    llmState.queue = [
      { text: "garbage", costCents: 1 },
      { text: "{still not a plan}", costCents: 1 }
    ];

    const res = await planFlow(planRequest("Plan something that fails twice."));
    expect(res.status).toBe(422);
    const logs = await prisma.activityLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].costCents).toBe(2);
  });

  it("rejects an oversize response with 422 and no retry", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    llmState.queue = [{ text: "x".repeat(100_001), costCents: 2 }];

    const res = await planFlow(planRequest("Plan a flow with a huge response."));
    expect(res.status).toBe(422);
    expect(llmState.calls).toBe(1); // no retry
    const logs = await prisma.activityLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].costCents).toBe(2);
  });

  it("returns 504 and logs cost 0 + timedOut when the provider exceeds the timeout", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    vi.stubEnv("ORCHESTRATOR_TIMEOUT_MS", "10");

    // Provider honors the abort signal but never resolves in time.
    llmState.provider = {
      name: "anthropic",
      model: "claude-sonnet-4-6",
      completeJson: vi.fn((params: unknown) =>
        new Promise<{ text: string; usage: { inputTokens: number; outputTokens: number }; costCents: number }>((_resolve, reject) => {
          const timer = setTimeout(() => _resolve({ text: "{}", usage: { inputTokens: 0, outputTokens: 0 }, costCents: 5 }), 1000);
          (params as { signal?: AbortSignal }).signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        })
      )
    };

    const res = await planFlow(planRequest("Plan a flow that times out."));
    expect(res.status).toBe(504);
    const logs = await prisma.activityLog.findMany({ where: { userId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].costCents).toBe(0);
    expect((logs[0].metadata as { timedOut?: boolean }).timedOut).toBe(true);

    vi.unstubAllEnvs();
  });

  it("429 over the daily cap makes zero provider calls", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await seedCatalog(user.id);
    // Seed prior spend at/over the default 100c cap.
    await prisma.activityLog.create({
      data: {
        userId: user.id, eventType: "orchestration", title: "prior", description: "prior",
        costCents: 100, metadata: { source: "orchestrator_plan" }
      }
    });

    const res = await planFlow(planRequest("Plan something over the cap."));
    expect(res.status).toBe(429);
    expect(llmState.calls).toBe(0);
  });
});
