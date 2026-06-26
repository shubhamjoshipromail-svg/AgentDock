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
      riskLevel: "medium", verificationStatus: "unverified", recommendedPermission: "approval_required"
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
