import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as attachTool } from "../app/api/workflows/[workflowId]/mcps/route";
import { POST as createWorkflow } from "../app/api/workflows/route";
import { GET as getSending, PATCH as patchSending } from "../app/api/profile/sending/route";

function jsonReq(url: string, body: unknown, method = "POST") {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function makeAgentAndFlow(userId: string) {
  const agent = await prisma.agent.create({
    data: { userId, name: "Outreach", category: "c", provider: "p", verified: true, description: "d", systemPrompt: "s", model: "claude-sonnet-4-6" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId, name: "Flow", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  await prisma.workflowAgent.create({ data: { workflowId: workflow.id, agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" } });
  return { agent, workflow };
}

async function makeSendServer() {
  return prisma.mcpServer.create({
    data: {
      name: "gmail-send", displayName: "Gmail Send", description: "d",
      registrySource: "discovered", registryId: "agentdock:discovered:gmail:send_email",
      riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "approval_required",
      mcpServerKey: "gmail", mcpToolName: "send_email", credentialProvider: "google", isExternalSend: true
    }
  });
}

async function makeDraftServer() {
  return prisma.mcpServer.create({
    data: {
      name: "gmail-draft", displayName: "Gmail Draft", description: "d",
      registrySource: "discovered", registryId: "agentdock:discovered:gmail:create_draft",
      riskLevel: "medium", verificationStatus: "verified", recommendedPermission: "approval_required",
      mcpServerKey: "gmail", mcpToolName: "create_draft", credentialProvider: "google", isExternalSend: false
    }
  });
}

describe("draft-only default — new users cannot be granted external sends until they opt in", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  it("new user defaults to sendingEnabled=false", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const res = await getSending();
    expect(res.status).toBe(200);
    expect((await res.json()).sendingEnabled).toBe(false);
  });

  it("attaching an external-send tool is refused (403) for a draft-only user, but a draft tool attaches", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await makeAgentAndFlow(user.id);
    const send = await makeSendServer();
    const draft = await makeDraftServer();

    const sendRes = await attachTool(
      jsonReq(`http://localhost/api/workflows/${workflow.id}/mcps`, { mcpServerId: send.id }),
      { params: Promise.resolve({ workflowId: workflow.id }) }
    );
    expect(sendRes.status).toBe(403);
    expect((await sendRes.json()).code).toBe("sending_disabled");
    expect(await prisma.mcpAccessGrant.count({ where: { userId: user.id, mcpServerId: send.id } })).toBe(0);

    // A draft tool (not an external send) attaches fine and is approval-gated.
    const draftRes = await attachTool(
      jsonReq(`http://localhost/api/workflows/${workflow.id}/mcps`, { mcpServerId: draft.id }),
      { params: Promise.resolve({ workflowId: workflow.id }) }
    );
    expect(draftRes.status).toBe(201);
    const grant = await prisma.mcpAccessGrant.findFirst({ where: { userId: user.id, mcpServerId: draft.id } });
    expect(grant).not.toBeNull();
    expect(grant!.requiresApproval).toBe(true); // drafts still require approval
  });

  it("enabling real sending lets the send tool attach and be granted", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { workflow } = await makeAgentAndFlow(user.id);
    const send = await makeSendServer();

    // Explicit opt-in via the settings route.
    const patch = await patchSending(jsonReq("http://localhost/api/profile/sending", { enabled: true }, "PATCH"));
    expect(patch.status).toBe(200);
    expect((await patch.json()).sendingEnabled).toBe(true);
    // Next request re-reads identity (mocked getCurrentUser returns this object).
    setCurrentUser({ ...user, sendingEnabled: true });

    const sendRes = await attachTool(
      jsonReq(`http://localhost/api/workflows/${workflow.id}/mcps`, { mcpServerId: send.id }),
      { params: Promise.resolve({ workflowId: workflow.id }) }
    );
    expect(sendRes.status).toBe(201);
    expect(await prisma.mcpAccessGrant.count({ where: { userId: user.id, mcpServerId: send.id } })).toBe(1);
  });

  it("saving a flow with a send tool skips the send grant and reports it (draft-only user)", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const send = await makeSendServer();
    const draft = await makeDraftServer();
    const agent = await prisma.agent.create({
      data: { userId: user.id, name: "Outreach", category: "c", provider: "p", verified: true, description: "d", systemPrompt: "s", model: "claude-sonnet-4-6" }
    });

    const res = await createWorkflow(jsonReq("http://localhost/api/workflows", {
      name: "Send Flow", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 150, approvalMode: "approval_gated",
      agents: [{ agentId: agent.id, roleInWorkflow: "r", routeOrder: 1, defaultMode: "auto" }],
      tools: [
        { mcpServerId: send.id, defaultPermission: "approval_required" },
        { mcpServerId: draft.id, defaultPermission: "approval_required" }
      ]
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sendingBlockedTools).toContain("Gmail Send");
    expect(data.message).toMatch(/sending is off/i);

    // The send grant was NOT created; the draft grant WAS.
    expect(await prisma.mcpAccessGrant.count({ where: { userId: user.id, mcpServerId: send.id } })).toBe(0);
    expect(await prisma.mcpAccessGrant.count({ where: { userId: user.id, mcpServerId: draft.id } })).toBe(1);
  });
});
