import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

const llm = vi.hoisted(() => ({ queue: [] as { text: string }[], calls: 0 }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llm.calls += 1;
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: 1 };
    })
  }))
}));

// Capture every real tool invocation so we can prove a refused action never ran.
const mcp = vi.hoisted(() => ({
  calls: [] as { toolName: string }[],
  reset() {
    this.calls = [];
  }
}));
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async (_serverKey: string, toolName: string) => {
      mcp.calls.push({ toolName });
      return { text: `ok: ${toolName}`, isError: false };
    })
  };
});

import { brokerCredentialForAction } from "../lib/execution/credential-broker";
import { startRun } from "../lib/execution/run-engine";
import { storeGoogleOAuthToken } from "../lib/execution/credentials";
import { resumeThroughQueue } from "./helpers/queue";

// ============================================================================
// THE MANDATE IS A REAL PRE-AUTHORIZATION (Chunk 22 Phase 5).
//
// The broker's scope/limit logic was correct, but the caller defeated both:
//   - run-engine passed `amountCents: costCents` where costCents was still 0 at
//     that point, so `amount > limit` was `0 > limit` — a limited mandate refused
//     nothing, ever;
//   - no requiredScope was ever passed, and a null grant scope short-circuited
//     the scope comparison, so a scopeless grant satisfied any action.
//
// This is the primitive a payment authorization will be built on, so "the limit
// is enforced" has to be true of the caller, not just the checker.
// ============================================================================

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) =>
  JSON.stringify({ type: "tool_call", tool, arguments: args });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

const SEND_SCOPE = "gmail:send_email";

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  llm.queue = [];
  llm.calls = 0;
  mcp.reset();
  vi.clearAllMocks();
  user = await createTestUser(`mandate-${Date.now()}-${Math.random()}@example.com`);
  setCurrentUser(user);
  delete process.env.RUN_TOOL_COST_CENTS;
});

async function seedSendFlow(grant: { limitCents?: number | null; scope?: string | null }) {
  const agent = await prisma.agent.create({
    data: {
      userId: user.id, name: "Sender", category: "c", provider: "p", verified: true,
      description: "d", systemPrompt: "Use send_email.", model: "claude-sonnet-4-6"
    }
  });
  const workflow = await prisma.workflow.create({
    data: {
      userId: user.id, name: "Send Flow", goal: "Send an email.", weeklyBudgetCents: 500,
      maxRunBudgetCents: 100, approvalMode: "approval_gated"
    }
  });
  await prisma.workflowAgent.create({
    data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" }
  });
  const server = await prisma.mcpServer.create({
    data: {
      name: "gmail-send_email", displayName: "Gmail: send_email", description: "d",
      registrySource: "discovered", registryId: "agentdock:discovered:gmail:send_email",
      riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "draft_only",
      mcpServerKey: "gmail", mcpToolName: "send_email", credentialProvider: "google", isExternalSend: true
    }
  });
  await prisma.mcpAccessGrant.create({
    data: {
      userId: user.id, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id,
      canRead: true, canWrite: true, requiresApproval: false,
      scope: grant.scope === undefined ? SEND_SCOPE : grant.scope,
      limitCents: grant.limitCents ?? null
    }
  });
  await storeGoogleOAuthToken(user.id, { accessToken: "tok", refreshToken: null, expiresAt: null });
  return { workflow };
}

// Drive a send to the point where the approval is granted and the tool would run.
async function runSendToCompletion(workflowId: string) {
  llm.queue = [
    { text: TOOL_ARGS("send_email", { to: "a@example.com", subject: "Hi", body: "Body" }) },
    { text: FINAL("sent") }
  ];
  const started = await startRun(user.id, workflowId);
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error("unexpected");

  const approval = await prisma.approvalRequest.findFirst({
    where: { workflowRunId: started.result.runId, status: "pending" },
    orderBy: { requestedAt: "desc" }
  });
  expect(approval).not.toBeNull();

  await resumeThroughQueue(user.id, approval!.id, true);
  return started.result.runId;
}

describe("broker: scope is deny-by-default", () => {
  it("a null-scope grant does NOT satisfy a scoped action", async () => {
    const outcome = await brokerCredentialForAction("google", user.id, {
      external: true,
      mandate: { scope: null, limitCents: null, expiresAt: null, revokedAt: null },
      requiredScope: SEND_SCOPE
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/scope/i);
  });

  it("an empty-string scope does NOT satisfy a scoped action", async () => {
    const outcome = await brokerCredentialForAction("google", user.id, {
      external: true,
      mandate: { scope: "   ", limitCents: null, expiresAt: null, revokedAt: null },
      requiredScope: SEND_SCOPE
    });
    expect(outcome.ok).toBe(false);
  });

  it("a grant scoped to a DIFFERENT action is refused", async () => {
    const outcome = await brokerCredentialForAction("google", user.id, {
      external: true,
      mandate: { scope: "gmail:create_draft", limitCents: null, expiresAt: null, revokedAt: null },
      requiredScope: SEND_SCOPE
    });
    expect(outcome.ok).toBe(false);
  });

  it("a matching scope is authorized", async () => {
    const outcome = await brokerCredentialForAction("google", user.id, {
      external: true,
      mandate: { scope: SEND_SCOPE, limitCents: null, expiresAt: null, revokedAt: null },
      requiredScope: SEND_SCOPE
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("the run engine hands the broker a REAL amount", () => {
  it("an action costing more than the mandate limit is refused and never executes", async () => {
    // The action's amount basis is 50c; the mandate authorizes 1c.
    process.env.RUN_TOOL_COST_CENTS = "50";
    const { workflow } = await seedSendFlow({ limitCents: 1 });

    const runId = await runSendToCompletion(workflow.id);

    // The send must never have reached the tool.
    expect(mcp.calls.map((c) => c.toolName)).not.toContain("send_email");

    const refusal = await prisma.workflowRunEvent.findFirst({
      where: { workflowRunId: runId, eventType: "mcp_tool_use" },
      orderBy: { createdAt: "desc" }
    });
    expect(JSON.stringify(refusal?.metadata ?? {})).toMatch(/broker refused|exceeds grant limit/i);
  });

  it("an action within the mandate limit is authorized and executes", async () => {
    process.env.RUN_TOOL_COST_CENTS = "5";
    const { workflow } = await seedSendFlow({ limitCents: 500 });

    await runSendToCompletion(workflow.id);

    expect(mcp.calls.map((c) => c.toolName)).toContain("send_email");
  });

  it("a scopeless grant cannot authorize an external send", async () => {
    const { workflow } = await seedSendFlow({ scope: null, limitCents: null });

    const runId = await runSendToCompletion(workflow.id);

    expect(mcp.calls.map((c) => c.toolName)).not.toContain("send_email");
    const refusal = await prisma.workflowRunEvent.findFirst({
      where: { workflowRunId: runId, eventType: "mcp_tool_use" },
      orderBy: { createdAt: "desc" }
    });
    expect(JSON.stringify(refusal?.metadata ?? {})).toMatch(/broker refused|scope/i);
  });
});

describe("grants carry a canonical scope", () => {
  it("every grant for an executable tool has a scope matching its canonical identity", async () => {
    const { workflow } = await seedSendFlow({ limitCents: null });

    const grants = await prisma.mcpAccessGrant.findMany({
      where: { workflowId: workflow.id },
      include: { mcpServer: { select: { mcpServerKey: true, mcpToolName: true } } }
    });
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant.scope).toBe(`${grant.mcpServer.mcpServerKey}:${grant.mcpServer.mcpToolName}`);
    }
  });
});
