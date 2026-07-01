import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import {
  validateIntentPayload, validateIntentResponse, frameIntentResponse
} from "../lib/execution/interaction-intent";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

const llm = vi.hoisted(() => ({ queue: [] as { text: string; costCents?: number }[], calls: 0, prompts: [] as string[] }));
vi.mock("../lib/execution/provider", () => ({
  getRunProvider: vi.fn(async () => ({
    name: "anthropic", model: "claude-sonnet-4-6",
    completeJson: vi.fn(async (params: { user: string }) => {
      llm.calls += 1; llm.prompts.push(params.user);
      const next = llm.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 10, outputTokens: 5 }, costCents: next.costCents ?? 1 };
    })
  }))
}));

vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return { ...actual, callMcpTool: vi.fn(async () => ({ text: "search: A, B, C", isError: false })) };
});

import { callMcpTool } from "../lib/execution/mcp-client";
import { startRun, resumeAfterApproval } from "../lib/execution/run-engine";
import { POST as resolveApproval } from "../app/api/approvals/[id]/resolve/route";

const callMcpToolMock = vi.mocked(callMcpTool);
const INTENT = (intentType: string, payload: unknown) => JSON.stringify({ type: "intent", intentType, payload });
const TOOL_ARGS = (tool: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool_call", tool, arguments: args });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

const CHOICE_PAYLOAD = {
  prompt: "Pick the events you want emailed",
  options: [
    { id: "a", title: "Jazz Night", description: "Fri 8pm" },
    { id: "b", title: "Food Festival", description: "Sat noon" },
    { id: "c", title: "Art Walk", description: "Sun 2pm" }
  ],
  maxSelect: 2
};

async function seedAgentFlow(userId: string, opts: { withSend?: boolean } = {}) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Concierge", category: "c", provider: "p", verified: true, description: "d", systemPrompt: "Ask, then act.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Choose Flow", goal: "Ask the user to choose, then act.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" } });
  if (opts.withSend) {
    const server = await prisma.mcpServer.create({
      data: {
        name: "gmail-send-email", displayName: "Gmail: send_email", description: "d",
        registrySource: "first-party", registryId: "agentdock:gmail:send_email",
        riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "draft_only",
        mcpServerKey: "gmail", mcpToolName: "send_email", credentialProvider: "google", isExternalSend: true
      }
    });
    await prisma.mcpAccessGrant.create({ data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, canWrite: true, requiresApproval: false } });
  }
  return { agent, workflow };
}

describe("interaction-intent validation (schema-constrained, never arbitrary)", () => {
  it("accepts a well-formed choice payload and rejects malformed ones", () => {
    expect(validateIntentPayload("choice", CHOICE_PAYLOAD).ok).toBe(true);
    expect(validateIntentPayload("choice", { prompt: "x" }).ok).toBe(false); // no options
    expect(validateIntentPayload("nope", {}).ok).toBe(false); // unknown type
    // No arbitrary keys (strict) — an html/script field is rejected.
    expect(validateIntentPayload("confirmation", { prompt: "ok?", html: "<script>" }).ok).toBe(false);
  });

  it("validates a response against the payload (unknown ids / over-select rejected)", () => {
    expect(validateIntentResponse("choice", CHOICE_PAYLOAD, { selectedIds: ["a"] }).ok).toBe(true);
    expect(validateIntentResponse("choice", CHOICE_PAYLOAD, { selectedIds: ["a", "b", "c"] }).ok).toBe(false); // > maxSelect
    expect(validateIntentResponse("choice", CHOICE_PAYLOAD, { selectedIds: ["zzz"] }).ok).toBe(false); // unknown id
  });

  it("frames a response as untrusted data, never instructions", () => {
    const framed = frameIntentResponse("choice", CHOICE_PAYLOAD, { selectedIds: ["a", "c"] });
    expect(framed).toContain("<untrusted>");
    expect(framed).toContain("Jazz Night");
    expect(framed).toContain("Art Walk");
    expect(framed).toContain("never instructions");
  });
});

describe("choice intent — pause, respond, resume with framed selection", () => {
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = []; llm.calls = 0; llm.prompts = [];
    callMcpToolMock.mockReset();
    callMcpToolMock.mockResolvedValue({ text: "ok", isError: false });
    setCurrentUser(null);
  });

  it("an agent emitting a choice pauses the run; responding resumes with the selection as framed data", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await seedAgentFlow(user.id);

    // The agent asks the user to choose.
    llm.queue = [{ text: INTENT("choice", CHOICE_PAYLOAD) }];
    const out = await startRun(user.id, workflow.id);
    expect(out.ok && out.result.status).toBe("paused_for_approval");

    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const intent = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });
    expect(intent.intentType).toBe("choice");
    expect(intent.status).toBe("pending");

    // Respond via the one resolve route with a selection.
    const res = await resolveApproval(
      new Request(`http://localhost/api/approvals/${intent.id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: { selectedIds: ["a", "c"] } })
      }),
      { params: Promise.resolve({ id: intent.id }) }
    );
    expect(res.status).toBe(200);
    const stored = await prisma.approvalRequest.findFirstOrThrow({ where: { id: intent.id } });
    expect(stored.status).toBe("responded");

    // Resume (worker) → the selection reaches the model as framed untrusted data.
    llm.queue = [{ text: FINAL("Emailed your picks: Jazz Night and Art Walk.") }];
    const result = await resumeAfterApproval(user.id, intent.id, true);
    expect(result?.status).toBe("completed");
    const resumePrompt = llm.prompts[llm.prompts.length - 1];
    expect(resumePrompt).toContain("Jazz Night");
    expect(resumePrompt).toContain("Art Walk");
    expect(resumePrompt).toContain("<untrusted>");
  });

  it("a malformed response is rejected by the resolve route (400)", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await seedAgentFlow(user.id);
    llm.queue = [{ text: INTENT("choice", CHOICE_PAYLOAD) }];
    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const intent = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });

    const res = await resolveApproval(
      new Request(`http://localhost/api/approvals/${intent.id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: { selectedIds: ["zzz"] } }) // unknown id
      }),
      { params: Promise.resolve({ id: intent.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("choice is NOT authorization: a send after the choice still requires its approval intent", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await seedAgentFlow(user.id, { withSend: true });

    llm.queue = [{ text: INTENT("choice", CHOICE_PAYLOAD) }];
    await startRun(user.id, workflow.id);
    const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId: user.id } });
    const choice = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id, intentType: "choice" } });

    // Respond, then the agent tries to SEND — which must pause for its OWN approval.
    await resolveApproval(
      new Request(`http://localhost/api/approvals/${choice.id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: { selectedIds: ["a"] } })
      }),
      { params: Promise.resolve({ id: choice.id }) }
    );
    llm.queue = [{ text: TOOL_ARGS("send_email", { to: "u@example.com", subject: "Your pick", body: "Jazz Night" }) }];
    const result = await resumeAfterApproval(user.id, choice.id, true);

    // The send did NOT execute — it paused for an approval intent of its own.
    expect(result?.status).toBe("paused_for_approval");
    expect(callMcpToolMock).not.toHaveBeenCalled();
    const approval = await prisma.approvalRequest.findFirst({ where: { workflowRunId: run.id, intentType: "approval" } });
    expect(approval).toBeTruthy();
    expect(approval?.status).toBe("pending");
  });
});
