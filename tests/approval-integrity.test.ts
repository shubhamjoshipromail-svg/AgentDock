import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Model mock: a queue of fake completions.
const llm = vi.hoisted(() => ({ queue: [] as { text: string; costCents?: number }[], calls: 0 }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llm.calls += 1;
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: next.costCents ?? 1 };
    })
  }))
}));

// Capture every MCP tool invocation (serverKey, toolName, args) so we can assert
// exactly what was — and was not — executed.
const mcp = vi.hoisted(() => ({ calls: [] as { toolName: string; args: Record<string, unknown> }[], reset() { this.calls = []; } }));
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async (_serverKey: string, toolName: string, args: Record<string, unknown>) => {
      mcp.calls.push({ toolName, args });
      return { text: `ok: ${toolName}`, isError: false };
    })
  };
});

import { startRun, resumeRunFromLatestApproval } from "../lib/execution/run-engine";
import { storeProviderKey, storeGoogleOAuthToken } from "../lib/execution/credentials";

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool_call", tool, arguments: args });
const TOOL = (tool: string, action = "read", input = "q") => JSON.stringify({ type: "tool_call", tool, action, input });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

// Seed a flow whose single tool is an external send (send_email on the pre-seeded
// gmail registration). An external send always hits the approval gate.
async function seedSendFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Sender", category: "c", provider: "p", verified: true, description: "d", systemPrompt: "Use send_email.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Send Flow", goal: "Send an email.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" } });
  const server = await prisma.mcpServer.create({
    data: {
      name: "gmail-send_email", displayName: "Gmail: send_email", description: "d",
      registrySource: "discovered", registryId: "agentdock:discovered:gmail:send_email",
      riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "draft_only",
      mcpServerKey: "gmail", mcpToolName: "send_email", credentialProvider: "google", isExternalSend: true
    }
  });
  await prisma.mcpAccessGrant.create({ data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, canWrite: true, requiresApproval: false } });
  return { workflow };
}

async function seedSearchFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Searcher", category: "c", provider: "p", verified: true, description: "d", systemPrompt: "Use web_search.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Search Flow", goal: "Look something up.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" } });
  const server = await prisma.mcpServer.create({
    data: {
      name: "search-web_search", displayName: "Search: web_search", description: "d",
      registrySource: "discovered", registryId: "agentdock:discovered:search:web_search",
      riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only",
      mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false
    }
  });
  await prisma.mcpAccessGrant.create({ data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, requiresApproval: false } });
  return { workflow };
}

async function pendingApprovalFor(runId: string) {
  return prisma.approvalRequest.findFirst({ where: { workflowRunId: runId, status: "pending" }, orderBy: { requestedAt: "desc" } });
}

function resolveReq(body: unknown) {
  return new Request("http://localhost/api/approvals/x/resolve", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

describe("approval integrity — what you approved is exactly what runs", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
    llm.queue = [];
    llm.calls = 0;
    mcp.reset();
    vi.clearAllMocks();
  });

  // TEST #5 — action-change-after-approval.
  it("resolving status=approved WITH editedArgs never executes the mutated action — it halts and demands a re-run", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await seedSendFlow(user.id);

    // The agent proposes sending to the real owner address.
    llm.queue = [TOOL_ARGS("send_email", { to: "owner@real.test", subject: "Hi", body: "Body" })].map((text) => ({ text }));
    const started = await startRun(user.id, workflow.id);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("unreachable");
    const runId = started.result.runId;
    expect(started.result.status).toBe("paused_for_approval");

    const approval = await pendingApprovalFor(runId);
    expect(approval).not.toBeNull();
    // The card displays the owner's address.
    expect((approval!.metadata as Record<string, Record<string, unknown>>).arguments?.to).toBe("owner@real.test");

    // The attacker tries to approve while swapping the recipient.
    const { POST } = await import("../app/api/approvals/[id]/resolve/route");
    const res = await POST(resolveReq({ status: "approved", editedArgs: { to: "attacker@evil.test" } }), { params: Promise.resolve({ id: approval!.id }) });
    const json = await res.json();

    // The run halted — the edited action was NOT executed.
    expect(json.run?.status).toBe("halted_error");
    const after = await prisma.approvalRequest.findUnique({ where: { id: approval!.id } });
    expect(after?.status).toBe("edited"); // coerced away from "approved"
    // The pending action's stored arguments were NOT mutated to the attacker value.
    expect((after!.metadata as Record<string, Record<string, unknown>>).arguments?.to).toBe("owner@real.test");

    // No send ever executed — with the original OR the mutated recipient.
    expect(mcp.calls.filter((c) => c.toolName === "send_email")).toHaveLength(0);

    // And a halted run cannot be resumed into executing the attacker's action.
    mcp.reset();
    llm.queue = [{ text: FINAL("done") }];
    const resumed = await resumeRunFromLatestApproval(user.id, runId);
    expect(resumed?.status).not.toBe("completed");
    expect(mcp.calls.find((c) => JSON.stringify(c.args).includes("attacker@evil.test"))).toBeUndefined();
    expect(mcp.calls.filter((c) => c.toolName === "send_email")).toHaveLength(0);
    setCurrentUser(null);
  });

  // Positive control — a plain approval (no edits) still executes the displayed action.
  it("resolving status=approved with NO edits executes exactly the displayed action", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await seedSendFlow(user.id);

    llm.queue = [TOOL_ARGS("send_email", { to: "owner@real.test", subject: "Hi", body: "Body" })].map((text) => ({ text }));
    const started = await startRun(user.id, workflow.id);
    if (!started.ok) throw new Error("unreachable");
    const runId = started.result.runId;
    const approval = await pendingApprovalFor(runId);
    expect(approval).not.toBeNull();

    const { POST } = await import("../app/api/approvals/[id]/resolve/route");
    const res = await POST(resolveReq({ status: "approved" }), { params: Promise.resolve({ id: approval!.id }) });
    expect(res.status).toBe(200);

    // Simulate the worker picking up the approved run.
    llm.queue = [{ text: FINAL("Email sent.") }];
    const resumed = await resumeRunFromLatestApproval(user.id, runId);
    expect(resumed?.status).not.toBe("halted_error");
    const sends = mcp.calls.filter((c) => c.toolName === "send_email");
    expect(sends).toHaveLength(1);
    expect(sends[0].args.to).toBe("owner@real.test");
    setCurrentUser(null);
  });

  // TEST #3 — cross-user (object-level) authorization on every [id] route.
  it("a second user cannot resolve, read, kill, or stream another user's run/approval", async () => {
    const owner = await createTestUser("owner@example.com");
    setCurrentUser(owner);
    const { workflow } = await seedSendFlow(owner.id);
    llm.queue = [TOOL_ARGS("send_email", { to: "owner@real.test", subject: "s", body: "b" })].map((text) => ({ text }));
    const started = await startRun(owner.id, workflow.id);
    if (!started.ok) throw new Error("unreachable");
    const runId = started.result.runId;
    const approval = await pendingApprovalFor(runId);
    expect(approval).not.toBeNull();

    // A different signed-in user.
    const attacker = await createTestUser("attacker@example.com");
    setCurrentUser(attacker);

    const resolveRoute = await import("../app/api/approvals/[id]/resolve/route");
    const runRoute = await import("../app/api/runs/[id]/route");
    const killRoute = await import("../app/api/runs/[id]/kill/route");
    const streamRoute = await import("../app/api/runs/[id]/stream/route");

    const resolveRes = await resolveRoute.POST(resolveReq({ status: "approved" }), { params: Promise.resolve({ id: approval!.id }) });
    expect(resolveRes.status).toBe(404);

    const getRes = await runRoute.GET(new Request("http://localhost/api/runs/x"), { params: Promise.resolve({ id: runId }) });
    expect(getRes.status).toBe(404);

    const killRes = await killRoute.POST(new Request("http://localhost/api/runs/x/kill", { method: "POST" }), { params: Promise.resolve({ id: runId }) });
    expect(killRes.status).toBe(404);

    const streamRes = await streamRoute.GET(new Request("http://localhost/api/runs/x/stream"), { params: Promise.resolve({ id: runId }) });
    expect(streamRes.status).toBe(404);

    // The owner's approval is untouched and the run is not killed.
    const stillPending = await prisma.approvalRequest.findUnique({ where: { id: approval!.id } });
    expect(stillPending?.status).toBe("pending");
    const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe("paused_for_approval");
    setCurrentUser(null);
  });

  // TEST #9 — no secret leakage into run events / resultText / stored columns.
  it("provider keys and OAuth tokens never appear in run events, resultText, or in plaintext at rest", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    const PROVIDER_KEY = "sk-ant-SECRET-DO-NOT-LEAK-abc123";
    const ACCESS_TOKEN = "ya29.SECRET-ACCESS-DO-NOT-LEAK";
    const REFRESH_TOKEN = "1//SECRET-REFRESH-DO-NOT-LEAK";
    await storeProviderKey(user.id, "anthropic", PROVIDER_KEY);
    await storeGoogleOAuthToken(user.id, { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt: Date.now() + 3_600_000 });

    const { workflow } = await seedSearchFlow(user.id);
    llm.queue = [TOOL("web_search", "read", "fish"), FINAL("Here is a summary.")].map((text) => ({ text }));
    const started = await startRun(user.id, workflow.id);
    expect(started.ok).toBe(true);

    const secrets = [PROVIDER_KEY, ACCESS_TOKEN, REFRESH_TOKEN];

    // 1. No secret in any run event (title/description/metadata).
    const events = await prisma.workflowRunEvent.findMany({ where: { userId: user.id } });
    const eventBlob = JSON.stringify(events);
    for (const s of secrets) expect(eventBlob.includes(s)).toBe(false);

    // 2. No secret in the run's user-facing resultText.
    const runs = await prisma.workflowRun.findMany({ where: { userId: user.id } });
    const resultBlob = JSON.stringify(runs.map((r) => r.resultText));
    for (const s of secrets) expect(resultBlob.includes(s)).toBe(false);

    // 3. No secret stored in plaintext at rest (encrypted columns only expose ciphertext).
    const creds = await prisma.scopedCredential.findMany({ where: { userId: user.id } });
    const credBlob = JSON.stringify(creds);
    for (const s of secrets) expect(credBlob.includes(s)).toBe(false);
    expect(creds.length).toBeGreaterThan(0); // sanity: something was actually stored
    setCurrentUser(null);
  });
});
