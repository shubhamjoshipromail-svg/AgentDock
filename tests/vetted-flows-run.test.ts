import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

const llm = vi.hoisted(() => ({
  queue: [] as string[],
  prompts: [] as string[]
}));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async (params: { user: string }) => {
      llm.prompts.push(params.user);
      const text = llm.queue.shift();
      if (!text) throw new Error("no queued completion");
      return { text, usage: { inputTokens: 20, outputTokens: 10 }, costCents: 1 };
    })
  }))
}));

vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async (_serverKey: string, toolName: string) => ({
      text: toolName === "web_search"
        ? "Alpha Agents — governed automation; Beta Labs — auditable workflows; Gamma AI — enterprise controls."
        : "Gmail draft id draft-123 created successfully.",
      isError: false
    }))
  };
});

import { callMcpTool } from "../lib/execution/mcp-client";
import { ensureVettedFlowsForUser, VETTED_FLOW_NAMES } from "../lib/catalog/vetted-flows";
import { storeGoogleOAuthToken } from "../lib/execution/credentials";
import { executeThroughQueue, resumeThroughQueue } from "./helpers/queue";
import { POST as startRunRoute } from "../app/api/runs/route";
import { POST as resolveApprovalRoute } from "../app/api/approvals/[id]/resolve/route";

const callMcpToolMock = vi.mocked(callMcpTool);
const FINAL = (text: string) => JSON.stringify({ type: "final", text });
const TOOL = (tool: string, args: Record<string, unknown>) =>
  JSON.stringify({ type: "tool_call", tool, arguments: args });
const INTENT = (intentType: string, payload: unknown) =>
  JSON.stringify({ type: "intent", intentType, payload });

async function enqueue(userId: string, workflowId: string) {
  const response = await startRunRoute(new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ workflowId })
  }));
  expect(response.status).toBe(201);
  const body = await response.json();
  await executeThroughQueue(userId, body.run.runId);
  return prisma.workflowRun.findUniqueOrThrow({ where: { id: body.run.runId } });
}

async function answerIntent(userId: string, approvalId: string, response: unknown) {
  const resolved = await resolveApprovalRoute(
    new Request(`http://localhost/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response })
    }),
    { params: Promise.resolve({ id: approvalId }) }
  );
  expect(resolved.status).toBe(200);
  return resumeThroughQueue(userId, approvalId, true);
}

async function approveAction(userId: string, approvalId: string) {
  const resolved = await resolveApprovalRoute(
    new Request(`http://localhost/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" })
    }),
    { params: Promise.resolve({ id: approvalId }) }
  );
  expect(resolved.status).toBe(200);
  return resumeThroughQueue(userId, approvalId, true);
}

async function expectCompleteFunnel(userId: string, runId: string) {
  const events = await prisma.productEvent.findMany({ where: { userId, runId } });
  const names = events.map((event) => event.event);
  expect(names).toContain("run_started");
  expect(names).toContain("approval_shown");
  expect(names).toContain("approval_resolved");
  expect(names).toContain("action_executed_real");
  expect(names).toContain("run_completed");
}

describe("Chunk 21 vetted flows — mocked end to end", () => {
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = [];
    llm.prompts = [];
    callMcpToolMock.mockClear();
    setCurrentUser(null);
  });

  it("runs Research & email me a summary through search, approval, draft, and clean final", async () => {
    const user = await createTestUser("summary@example.com");
    setCurrentUser(user);
    const { workflows } = await ensureVettedFlowsForUser(prisma, user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.SUMMARY", expiresAt: Date.now() + 3_600_000 });
    llm.queue = [
      TOOL("web_search", { query: "governed AI agent platforms latest developments" }),
      TOOL("create_draft", { to: user.email, subject: "Governed AI agent summary", body: "Alpha, Beta, and Gamma findings." })
    ];

    const run = await enqueue(user.id, workflows[0].id);
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id, status: "pending" } });
    expect(callMcpToolMock.mock.calls.map((call) => call[1])).toEqual(["web_search"]);
    llm.queue = [FINAL("Research complete. A Gmail draft with the governed-agent summary was created for review.")];
    expect((await approveAction(user.id, approval.id))?.status).toBe("completed");

    expect(callMcpToolMock.mock.calls.map((call) => call[1])).toEqual(["web_search", "create_draft"]);
    expect((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).resultText)
      .toContain("Gmail draft");
    await expectCompleteFunnel(user.id, run.id);
  });

  it("runs Research → choose → email picks through a real choice surface", async () => {
    const user = await createTestUser("choice@example.com");
    setCurrentUser(user);
    const { workflows } = await ensureVettedFlowsForUser(prisma, user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.CHOICE", expiresAt: Date.now() + 3_600_000 });
    llm.queue = [
      TOOL("web_search", { query: "notable AI agent platform companies" }),
      // A provider may repeat the successful read once. The runtime removes
      // that completed tool from the next model turn instead of halting before
      // the required A2UI choice can be emitted.
      TOOL("web_search", { query: "notable AI agent platform companies" }),
      INTENT("choice", {
        prompt: "Choose up to three options to email",
        options: [
          { id: "alpha", title: "Alpha Agents", description: "Governed automation" },
          { id: "beta", title: "Beta Labs", description: "Auditable workflows" },
          { id: "gamma", title: "Gamma AI", description: "Enterprise controls" }
        ],
        maxSelect: 3
      })
    ];

    const run = await enqueue(user.id, workflows[1].id);
    const choice = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, intentType: "choice", status: "pending" }
    });
    expect(callMcpToolMock.mock.calls.filter((call) => call[1] === "web_search")).toHaveLength(1);
    llm.queue = [
      TOOL("create_draft", {
        to: user.email,
        subject: "Your selected AI agent platforms",
        body: "Alpha Agents and Gamma AI"
      })
    ];
    expect((await answerIntent(user.id, choice.id, { selectedIds: ["alpha", "gamma"] }))?.status)
      .toBe("paused_for_approval");
    const draftApproval = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, intentType: "approval", status: "pending" }
    });
    const approvedBody = String(
      ((draftApproval.metadata as { arguments?: { body?: unknown } }).arguments?.body) ?? ""
    );
    expect(approvedBody).toContain("Alpha Agents and Gamma AI");
    expect(approvedBody).not.toContain("Beta Labs");

    llm.queue = [FINAL("Your selected Alpha Agents and Gamma AI picks are in a Gmail draft for review.")];
    expect((await approveAction(user.id, draftApproval.id))?.status).toBe("completed");
    expect(llm.prompts.some((prompt) => prompt.includes("Alpha Agents") && prompt.includes("Gamma AI"))).toBe(true);
    await expectCompleteFunnel(user.id, run.id);
  });

  it("runs Brief → draft through the exact three-field form and draft approval", async () => {
    const user = await createTestUser("brief@example.com");
    setCurrentUser(user);
    const { workflows } = await ensureVettedFlowsForUser(prisma, user.id);
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.BRIEF", expiresAt: Date.now() + 3_600_000 });
    llm.queue = [INTENT("form", {
      prompt: "Tell me about the draft",
      fields: [
        { name: "audience", label: "Audience", type: "string", required: true },
        { name: "tone", label: "Tone", type: "string", required: true },
        { name: "key_point", label: "Key point", type: "string", required: true }
      ]
    })];

    const run = await enqueue(user.id, workflows[2].id);
    const form = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, intentType: "form", status: "pending" }
    });
    llm.queue = [TOOL("create_draft", {
      to: user.email,
      subject: "Investor update",
      body: "A crisp investor update: the governed workflow MVP is ready."
    })];
    expect((await answerIntent(user.id, form.id, {
      values: { audience: "investors", tone: "crisp", key_point: "the governed workflow MVP is ready" }
    }))?.status).toBe("paused_for_approval");
    const draftApproval = await prisma.approvalRequest.findFirstOrThrow({
      where: { workflowRunId: run.id, intentType: "approval", status: "pending" }
    });

    llm.queue = [FINAL("A crisp investor-update Gmail draft was created for review.")];
    expect((await approveAction(user.id, draftApproval.id))?.status).toBe("completed");
    expect(callMcpToolMock.mock.calls.map((call) => call[1])).toEqual(["create_draft"]);
    expect(llm.prompts.some((prompt) => prompt.includes("investors") && prompt.includes("crisp"))).toBe(true);
    await expectCompleteFunnel(user.id, run.id);
  });

  it("installs the workflows in the declared dropdown order", () => {
    expect(VETTED_FLOW_NAMES).toEqual([
      "Research & email me a summary",
      "Research → you choose → email your picks",
      "Brief → draft"
    ]);
  });
});
