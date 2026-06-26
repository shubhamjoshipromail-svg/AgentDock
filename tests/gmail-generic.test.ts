import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Mock the model: a queue of fake completions.
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

// Capture the env handed to the MCP server so we can assert the brokered token is
// injected — and ONLY into the server's env, never the agent.
const captured = vi.hoisted(() => ({ calls: [] as { serverKey: string; toolName: string; env: Record<string, string> | undefined }[] }));
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async (serverKey: string, toolName: string, _args: Record<string, unknown>, ctx?: { env?: Record<string, string> }) => {
      captured.calls.push({ serverKey, toolName, env: ctx?.env });
      return { text: `ok: ${toolName}`, isError: false };
    })
  };
});

import { startRun, resumeAfterApproval } from "../lib/execution/run-engine";
import { registerCredentialProvider } from "../lib/execution/credential-broker";

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) => JSON.stringify({ type: "tool_call", tool, arguments: args });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

// Seed a flow with a single external-send MCP tool for an arbitrary registered,
// credentialed server. NOTHING here is Gmail-specific — serverKey, toolName,
// credentialProvider and tokenEnvVar are all data.
async function seedSendFlow(userId: string, opts: { serverKey: string; toolName: string; credentialProvider: string; tokenEnvVar: string }) {
  const agent = await prisma.agent.create({
    data: { userId, name: `${opts.serverKey} Agent`, category: "c", provider: "p", verified: true, description: "d", systemPrompt: "Use the send tool.", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: `${opts.serverKey} Flow`, goal: "Send something.", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" } });

  // Registration row (DATA) — how the server is reached + which broker/env it uses.
  // Upsert: first-party keys (gmail/search) are pre-seeded by resetDatabase, so a
  // create would hit the unique constraint.
  await prisma.serverRegistration.upsert({
    where: { serverKey: opts.serverKey },
    create: { serverKey: opts.serverKey, displayName: opts.serverKey, transport: "stdio", command: "node", args: ["x.js"], credentialProvider: opts.credentialProvider, tokenEnvVar: opts.tokenEnvVar },
    update: { displayName: opts.serverKey, transport: "stdio", command: "node", args: ["x.js"], credentialProvider: opts.credentialProvider, tokenEnvVar: opts.tokenEnvVar }
  });
  // Discovered grantable tool row (MCP identity) — the generic execution columns.
  const server = await prisma.mcpServer.create({
    data: {
      name: `${opts.serverKey}-${opts.toolName}`, displayName: `${opts.serverKey}: ${opts.toolName}`, description: "d",
      registrySource: "discovered", registryId: `agentdock:discovered:${opts.serverKey}:${opts.toolName}`,
      riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "draft_only",
      mcpServerKey: opts.serverKey, mcpToolName: opts.toolName, credentialProvider: opts.credentialProvider, isExternalSend: true
    }
  });
  await prisma.mcpAccessGrant.create({ data: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id, canRead: true, canWrite: true, requiresApproval: false } });
  return { workflow };
}

// Drive a send to approval, approve, and return what the MCP client received.
async function runSendAndApprove(userId: string, workflowId: string, toolName: string) {
  llm.queue = [{ text: TOOL_ARGS(toolName, { to: "a@example.com", subject: "Hi", body: "Hello" }) }];
  await startRun(userId, workflowId);
  const run = await prisma.workflowRun.findFirstOrThrow({ where: { userId } });
  expect(run.status).toBe("paused_for_approval"); // external send always halts
  const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });
  llm.queue = [{ text: FINAL("sent") }];
  await resumeAfterApproval(userId, approval.id, true);
  return run;
}

describe("Gmail runs through the GENERIC path — a second server needs zero new code", () => {
  const disposers: (() => void)[] = [];
  beforeEach(async () => {
    await resetDatabase();
    llm.queue = [];
    llm.calls = 0;
    captured.calls = [];
    setCurrentUser(null);
  });
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  it("Gmail send: halts for approval, then executes via callMcpTool with the brokered token in the server env only", async () => {
    const user = await createTestUser("gmail-e2e@example.com");
    // Gmail's google provider is real; store the user's encrypted token.
    const { storeGoogleOAuthToken } = await import("../lib/execution/credentials");
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.GMAIL", expiresAt: Date.now() + 3_600_000 });
    const { workflow } = await seedSendFlow(user.id, { serverKey: "gmail", toolName: "send_email", credentialProvider: "google", tokenEnvVar: "GMAIL_ACCESS_TOKEN" });

    await runSendAndApprove(user.id, workflow.id, "send_email");

    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0];
    expect(call.serverKey).toBe("gmail");
    expect(call.toolName).toBe("send_email");
    expect(call.env?.GMAIL_ACCESS_TOKEN).toBe("ya29.GMAIL");
  });

  it("a SECOND credentialed server (mock provider) runs the IDENTICAL path — no new execution/broker code", async () => {
    const user = await createTestUser("acme-e2e@example.com");
    // Register a second provider with ONLY data + a provider entry (the seam).
    disposers.push(registerCredentialProvider("acme", async (uid) => `acme-token-${uid}`));
    const { workflow } = await seedSendFlow(user.id, { serverKey: "acme", toolName: "acme_send", credentialProvider: "acme", tokenEnvVar: "ACME_TOKEN" });

    await runSendAndApprove(user.id, workflow.id, "acme_send");

    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0];
    expect(call.serverKey).toBe("acme");
    expect(call.toolName).toBe("acme_send");
    // The second server got its brokered token injected by the SAME mcpServerEnv
    // + broker code that serves Gmail — zero Gmail/acme-specific execution code.
    expect(call.env?.ACME_TOKEN).toBe(`acme-token-${user.id}`);
  });
});
