import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Mock the BYO provider (no network). Queue of fake completions.
const llm = vi.hoisted(() => ({ queue: [] as { text: string; costCents?: number }[], calls: 0, prompts: [] as string[] }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async (params: { user: string }) => {
      llm.calls += 1;
      llm.prompts.push(params.user);
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: next.costCents ?? 1 };
    })
  }))
}));

// Mock only the MCP transport-level callTool; keep the name helpers real so the
// engine's routing logic is exercised for real.
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return { ...actual, callMcpTool: vi.fn(async () => ({ text: "ok: performed", isError: false })) };
});

import { callMcpTool } from "../lib/execution/mcp-client";
import { startRun, resumeAfterApproval } from "../lib/execution/run-engine";
import { storeGoogleOAuthToken } from "../lib/execution/credentials";

const callMcpToolMock = vi.mocked(callMcpTool);

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool_call", tool, arguments: args });
// Legacy single-string form the model sometimes emits instead of structured args.
const TOOL_INPUT = (tool: string, action: string, input: string) => JSON.stringify({ type: "tool_call", tool, action, input });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

async function seedSearchFlow(userId: string, suffix = "default") {
  const agent = await prisma.agent.create({
    data: { userId, name: "Research Agent", category: "Research", provider: "OpenAI", verified: true, description: "Researches.", systemPrompt: "Use web_search.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Research Flow", goal: "Research a topic.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "research", routeOrder: 1, defaultMode: "auto" } });
  const server = await prisma.mcpServer.create({
    data: {
      name: `search-mcp-${suffix}`, displayName: "Search MCP", description: "Web search.",
      registrySource: "first-party", registryId: `agentdock:search:web_search:${suffix}`,
      riskLevel: "low", verificationStatus: "verified", recommendedPermission: "read_only",
      mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false
    }
  });
  await prisma.mcpAccessGrant.create({
    data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, requiresApproval: false }
  });
  return { agent, workflow };
}

async function seedGmailFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Outreach Agent", category: "Comms", provider: "OpenAI", verified: true, description: "Drafts + sends.", systemPrompt: "Use the email tools.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Outreach Flow", goal: "Email a contact.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "outreach", routeOrder: 1, defaultMode: "auto" } });

  // Each discovered Gmail tool is its own grantable McpServer row, identified by
  // the generic execution columns (no name hack).
  for (const tool of ["create_draft", "send_email"]) {
    const server = await prisma.mcpServer.create({
      data: {
        name: `gmail-${tool.replace("_", "-")}`,
        displayName: `Gmail: ${tool}`,
        description: `Gmail ${tool}`,
        registrySource: "first-party",
        registryId: `agentdock:gmail:${tool}`,
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "draft_only",
        mcpServerKey: "gmail",
        mcpToolName: tool,
        credentialProvider: "google",
        isExternalSend: tool === "send_email"
      }
    });
    // draft_only grant (canWrite, no approval flag): create_draft → allowed,
    // send_email → approval (external send) by classification.
    await prisma.mcpAccessGrant.create({
      data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, canWrite: true, requiresApproval: false }
    });
  }
  return { agent, workflow };
}

describe("MCP execution — governed Gmail tools through the gate", () => {
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = [];
    llm.calls = 0;
    llm.prompts = [];
    callMcpToolMock.mockReset();
    callMcpToolMock.mockResolvedValue({ text: "ok: performed", isError: false });
    setCurrentUser(null);
  });

  it("send_email requires approval and is NOT auto-executed", async () => {
    const user = await createTestUser();
    const { workflow } = await seedGmailFlow(user.id);
    llm.queue = [{ text: TOOL_ARGS("send_email", { to: "a@example.com", subject: "Hi", body: "Hello" }) }];

    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });

    expect(run.status).toBe("paused_for_approval");
    expect(callMcpToolMock).not.toHaveBeenCalled();
    const approval = await prisma.approvalRequest.findFirst({ where: { workflowRunId: run.id, status: "pending" } });
    expect(approval).toBeTruthy();
    // The approval carries the exact structured arguments for human review.
    expect(JSON.stringify(approval?.metadata)).toContain("a@example.com");
  });

  it("after approval + re-gate, send_email calls the MCP client with structured args + server-side token", async () => {
    const user = await createTestUser();
    const { workflow } = await seedGmailFlow(user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.LIVE", expiresAt: Date.now() + 3_600_000 });

    llm.queue = [{ text: TOOL_ARGS("send_email", { to: "a@example.com", subject: "Hi", body: "Hello" }) }];
    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });

    llm.queue = [{ text: FINAL("Email sent.") }];
    await resumeAfterApproval(user.id, approval.id, true);

    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    const [server, toolName, args, ctx] = callMcpToolMock.mock.calls[0];
    expect(server).toBe("gmail");
    expect(toolName).toBe("send_email");
    expect(args).toEqual({ to: "a@example.com", subject: "Hi", body: "Hello" });
    // The user's token is handed to the server via its env, never to the agent.
    expect(ctx?.env?.GMAIL_ACCESS_TOKEN).toBe("ya29.LIVE");
  });

  it("create_draft executes WITHOUT approval (safe, no external side effect)", async () => {
    const user = await createTestUser();
    const { workflow } = await seedGmailFlow(user.id);
    llm.queue = [
      { text: TOOL_ARGS("create_draft", { to: "b@example.com", subject: "Draft", body: "Body" }) },
      { text: FINAL("Draft created.") }
    ];

    const outcome = await startRun(user.id, workflow.id);
    expect(outcome.ok).toBe(true);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    expect(run.status).toBe("completed");
    expect(await prisma.approvalRequest.count({ where: { workflowRunId: run.id } })).toBe(0);

    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    const [server, toolName] = callMcpToolMock.mock.calls[0];
    expect(server).toBe("gmail");
    expect(toolName).toBe("create_draft");
  });

  it("a send that ERRORS is reported as failure, never framed as success", async () => {
    const user = await createTestUser();
    const { workflow } = await seedGmailFlow(user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.LIVE", expiresAt: Date.now() + 3_600_000 });
    // The real send errors (e.g. Gmail API disabled).
    callMcpToolMock.mockResolvedValue({ text: "Gmail API has not been used in project … or it is disabled.", isError: true });

    llm.queue = [{ text: TOOL_ARGS("send_email", { to: "a@example.com", subject: "Hi", body: "Hello" }) }];
    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });

    // Approve → the real send errors. The run must end honestly, NOT completed.
    const resumeResult = await resumeAfterApproval(user.id, approval.id, true);
    expect(resumeResult?.status).toBe("halted_error");

    const finalRun = await prisma.workflowRun.findFirstOrThrow({ where: { id: run.id } });
    expect(finalRun.status).toBe("halted_error");
    expect(finalRun.resultText).toBeNull(); // no fabricated "sent" deliverable

    // Audit records the failure with the real reason; the halt carries it too.
    const ev = await prisma.workflowRunEvent.findFirstOrThrow({
      where: { workflowRunId: run.id, eventType: "mcp_tool_use" }, orderBy: { createdAt: "desc" }
    });
    expect(ev.title).toContain("(failed)");
    expect((ev.metadata as Record<string, unknown>).error).toBe(true);
    expect(String((ev.metadata as Record<string, unknown>).toolOutput)).toContain("[tool error]");

    const halt = await prisma.workflowRunEvent.findFirstOrThrow({
      where: { workflowRunId: run.id, eventType: "action_blocked", title: "Run halted" }, orderBy: { createdAt: "desc" }
    });
    expect(halt.description).toMatch(/send_email failed/i);
    expect(halt.description).toMatch(/disabled/i);
  });

  it("search reaches web_search with a non-empty query whether the model used legacy input OR structured args", async () => {
    // Legacy single-string `input` form.
    const u1 = await createTestUser("legacy-search@example.com");
    const { workflow: w1 } = await seedSearchFlow(u1.id, "legacy");
    llm.queue = [{ text: TOOL_INPUT("web_search", "read", "types of carp") }, { text: FINAL("Here are the carp types.") }];
    await startRun(u1.id, w1.id);
    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    {
      const [server, toolName, args] = callMcpToolMock.mock.calls[0];
      expect(server).toBe("search");
      expect(toolName).toBe("web_search");
      expect(args).toEqual({ query: "types of carp" });
    }

    // Structured `arguments` form — same dispatch.
    callMcpToolMock.mockClear();
    const u2 = await createTestUser("structured-search@example.com");
    const { workflow: w2 } = await seedSearchFlow(u2.id, "structured");
    llm.queue = [{ text: TOOL_ARGS("web_search", { query: "lake victoria fish" }) }, { text: FINAL("Done.") }];
    await startRun(u2.id, w2.id);
    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    {
      const [, , args] = callMcpToolMock.mock.calls[0];
      expect(args).toEqual({ query: "lake victoria fish" });
    }
  });

  it("a search that ERRORS halts honestly — never falls back to a hallucinated, completed run", async () => {
    const user = await createTestUser("search-error@example.com");
    const { workflow } = await seedSearchFlow(user.id, "err");
    callMcpToolMock.mockResolvedValue({ text: "search unavailable (network error)", isError: true });

    // Even if the model would happily produce a confident answer from "general
    // knowledge", the failed tool ends the run honestly.
    llm.queue = [
      { text: TOOL_INPUT("web_search", "read", "types of carp") },
      { text: FINAL("Carps include common carp, grass carp, silver carp ...") }
    ];
    const result = await startRun(user.id, workflow.id);
    expect(result.ok && result.result.status).toBe("halted_error");

    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    expect(run.status).toBe("halted_error");
    expect(run.resultText).toBeNull(); // no hallucinated deliverable
    const halt = await prisma.workflowRunEvent.findFirstOrThrow({
      where: { workflowRunId: run.id, eventType: "action_blocked", title: "Run halted" }, orderBy: { createdAt: "desc" }
    });
    expect(halt.description).toMatch(/web_search failed/i);
  });

  it("a send_email with no usable arguments fails honestly (missing fields) and never dispatches", async () => {
    const user = await createTestUser();
    const { workflow } = await seedGmailFlow(user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.LIVE", expiresAt: Date.now() + 3_600_000 });

    // Empty arguments object — required to/subject/body all missing.
    llm.queue = [{ text: TOOL_ARGS("send_email", {}) }];
    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });

    llm.queue = [{ text: FINAL("The email could not be sent — required fields were missing.") }];
    await resumeAfterApproval(user.id, approval.id, true);

    // The tool was never dispatched with an empty/partial object.
    expect(callMcpToolMock).not.toHaveBeenCalled();
    const ev = await prisma.workflowRunEvent.findFirstOrThrow({
      where: { workflowRunId: run.id, eventType: "mcp_tool_use" }, orderBy: { createdAt: "desc" }
    });
    expect(ev.title).toContain("(failed)");
    expect(String((ev.metadata as Record<string, unknown>).toolOutput)).toMatch(/missing required argument/i);
  });
});
