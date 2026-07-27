import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";

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

const mcp = vi.hoisted(() => ({ calls: [] as string[], reset() { this.calls = []; } }));
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async (_key: string, toolName: string) => {
      mcp.calls.push(toolName);
      return { text: `ok: ${toolName}`, isError: false };
    })
  };
});

import { startRun } from "../lib/execution/run-engine";
import { storeGoogleOAuthToken } from "../lib/execution/credentials";
import { resumeThroughQueue } from "./helpers/queue";

const { ensureVettedFlowsForUser } = require("../lib/catalog/vetted-flows");

// ============================================================================
// THE GMAIL SEND PATH — why a send does or does not happen (Chunk 24 Phase 1).
//
// "Sends are not going through" has several possible causes and they are NOT
// equivalent. This file pins each one so the next person does not have to guess:
//
//   1. Draft-only default (Chunk 20): a user who has not enabled real sending is
//      never GRANTED a send tool at all. The flow drafts instead. This is the
//      designed behaviour and by far the most likely cause of a "silent" send
//      failure -- nothing is broken, the capability was never granted.
//   2. Mandate scope (Chunk 22 Phase 5): a grant whose scope does not name the
//      canonical authority authorizes nothing. Grants created before that change
//      carried NO scope and are repaired by the backfill migration.
//   3. A genuinely mismatched scope must still be refused -- and legibly.
// ============================================================================

const TOOL_ARGS = (tool: string, args: Record<string, unknown>) =>
  JSON.stringify({ type: "tool_call", tool, arguments: args });
const FINAL = (text = "done") => JSON.stringify({ type: "final", text });

// The exact statement shipped in 20260727000003_chunk22_phase5_grant_scope_backfill.
const BACKFILL_SQL = `
  UPDATE "mcp_access_grants" g
  SET "scope" = s."mcp_server_key" || ':' || s."mcp_tool_name"
  FROM "mcp_servers" s
  WHERE g."mcp_server_id" = s."id"
    AND (g."scope" IS NULL OR btrim(g."scope") = '')
    AND s."mcp_server_key" IS NOT NULL
    AND s."mcp_tool_name" IS NOT NULL`;

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  llm.queue = [];
  llm.calls = 0;
  mcp.reset();
  vi.clearAllMocks();
  user = await createTestUser(`send-${Date.now()}-${Math.random()}@example.com`);
});

async function seedSendFlow(scope: string | null) {
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
  const grant = await prisma.mcpAccessGrant.create({
    data: {
      userId: user.id, workflowId: workflow.id, agentId: agent.id, mcpServerId: server.id,
      canRead: true, canWrite: true, requiresApproval: false, scope
    }
  });
  await storeGoogleOAuthToken(user.id, { accessToken: "tok", refreshToken: null, expiresAt: null });
  return { workflow, grant };
}

async function driveSend(workflowId: string) {
  llm.queue = [
    { text: TOOL_ARGS("send_email", { to: "a@example.com", subject: "Hi", body: "Body" }) },
    { text: FINAL("sent") }
  ];
  const started = await startRun(user.id, workflowId);
  if (!started.ok) throw new Error("run did not start");
  const approval = await prisma.approvalRequest.findFirst({
    where: { workflowRunId: started.result.runId, status: "pending" },
    orderBy: { requestedAt: "desc" }
  });
  expect(approval, "an external send must raise an approval").not.toBeNull();
  await resumeThroughQueue(user.id, approval!.id, true);
  return started.result.runId;
}

async function lastToolEvent(runId: string) {
  return prisma.workflowRunEvent.findFirst({
    where: { workflowRunId: runId, eventType: "mcp_tool_use" },
    orderBy: { createdAt: "desc" }
  });
}

describe("cause 1: the draft-only default withholds the send tool entirely", () => {
  it("a user who has not enabled sending is granted NO send tool", async () => {
    await ensureVettedFlowsForUser(prisma, user.id);

    const sendGrants = await prisma.mcpAccessGrant.findMany({
      where: { userId: user.id, mcpServer: { mcpToolName: "send_email" } }
    });
    // Not a failure to send -- the capability was never granted. This is the
    // single most likely explanation for "sends are not going through".
    expect(sendGrants).toHaveLength(0);
  });

  it("enabling sending grants the send tool WITH canonical scope", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { sendingEnabled: true } });
    await ensureVettedFlowsForUser(prisma, user.id);

    const sendGrants = await prisma.mcpAccessGrant.findMany({
      where: { userId: user.id, mcpServer: { mcpToolName: "send_email" } }
    });
    expect(sendGrants.length).toBeGreaterThan(0);
    for (const grant of sendGrants) {
      expect(grant.scope).toBe("gmail:send_email");
    }
  });
});

describe("cause 2: a pre-Chunk-22 grant is repaired by the backfill", () => {
  it("a legacy scopeless grant still authorizes its send after the backfill runs", async () => {
    // Exactly the shape a grant had before Chunk 22 Phase 5: no scope at all.
    const { workflow, grant } = await seedSendFlow(null);
    expect(grant.scope).toBeNull();

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const repaired = await prisma.mcpAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(repaired.scope).toBe("gmail:send_email");

    await driveSend(workflow.id);
    expect(mcp.calls).toContain("send_email");
  });

  it("an unrepaired scopeless grant is refused, and the reason names the authority", async () => {
    const { workflow } = await seedSendFlow(null);

    const runId = await driveSend(workflow.id);

    expect(mcp.calls).not.toContain("send_email");
    const event = await lastToolEvent(runId);
    const rendered = `${event?.title ?? ""} ${event?.description ?? ""} ${JSON.stringify(event?.metadata ?? {})}`;
    // A security refusal that presents as silence is its own bug: the audit must
    // say WHAT was refused and WHY.
    expect(rendered).toMatch(/send_email/);
    expect(rendered).toMatch(/scope/i);
  });
});

describe("registration sources agree on the isolation floor", () => {
  it("the vetted-flow registrations declare the same env allowlist as the curated source", async () => {
    const { CURATED_SERVER_REGISTRATIONS } = await import("../lib/registry/server-registrations");
    await ensureVettedFlowsForUser(prisma, user.id);

    for (const curated of CURATED_SERVER_REGISTRATIONS) {
      const row = await prisma.serverRegistration.findUnique({
        where: { serverKey: curated.serverKey },
        select: { serverKey: true, envAllowlist: true }
      });
      // vetted-flows.js holds its own copy of the registration data. If the two
      // drift, a server silently loses (or gains) host environment access.
      expect(row?.envAllowlist, `${curated.serverKey} env allowlist drifted`).toEqual(curated.envAllowlist ?? []);
    }
  });
});

describe("cause 3: a genuinely mismatched scope stays refused", () => {
  it("a grant scoped to a different tool cannot authorize a send", async () => {
    const { workflow } = await seedSendFlow("gmail:create_draft");

    const runId = await driveSend(workflow.id);

    expect(mcp.calls).not.toContain("send_email");
    const event = await lastToolEvent(runId);
    const rendered = `${event?.title ?? ""} ${event?.description ?? ""} ${JSON.stringify(event?.metadata ?? {})}`;
    expect(rendered).toMatch(/scope/i);
  });

  it("the backfill does NOT overwrite a deliberately narrower scope", async () => {
    const { grant } = await seedSendFlow("gmail:create_draft");

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    // Backfill only fills NULL/blank scopes; it must never widen an existing one.
    const after = await prisma.mcpAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(after.scope).toBe("gmail:create_draft");
  });
});
