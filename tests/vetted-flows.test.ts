import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { POST as bootstrap } from "../app/api/bootstrap/route";
import {
  VETTED_FLOW_NAMES,
  ensureVettedFlowsForUser
} from "../lib/catalog/vetted-flows";

describe("Chunk 21 vetted flows", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  it("bootstraps exactly the three vetted active flows for a fresh user", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    const response = await bootstrap();
    expect(response.status).toBe(200);
    const flows = await prisma.workflow.findMany({
      where: { userId: user.id, status: { not: "archived" } },
      orderBy: { createdAt: "asc" }
    });

    expect(flows.map((flow) => flow.name)).toEqual(VETTED_FLOW_NAMES);
    expect(flows).toHaveLength(3);
    expect(flows.every((flow) => flow.approvalMode === "approval_gated")).toBe(true);
    expect(flows.every((flow) => flow.name !== "Job Search Automation")).toBe(true);
  });

  it("is idempotent, backfills existing users, and preserves their own or archived flows", async () => {
    const user = await createTestUser();
    const custom = await prisma.workflow.create({
      data: {
        userId: user.id,
        name: "My live customer flow",
        goal: "Do not overwrite this goal.",
        status: "active",
        weeklyBudgetCents: 777,
        maxRunBudgetCents: 88,
        approvalMode: "manual"
      }
    });

    const first = await ensureVettedFlowsForUser(prisma, user.id);
    const ids = first.workflows.map((flow) => flow.id);
    await prisma.workflow.update({
      where: { id: first.workflows[0].id },
      data: { status: "archived" }
    });
    const second = await ensureVettedFlowsForUser(prisma, user.id);

    expect(second.workflows.map((flow) => flow.id)).toEqual(ids);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: first.workflows[0].id } })).status)
      .toBe("archived");
    expect(await prisma.workflow.count({ where: { userId: user.id } })).toBe(4);
    expect(await prisma.workflow.findUniqueOrThrow({ where: { id: custom.id } })).toMatchObject({
      goal: "Do not overwrite this goal.",
      weeklyBudgetCents: 777,
      approvalMode: "manual"
    });
  });

  it("serializes concurrent bootstrap attempts into one vetted set", async () => {
    const user = await createTestUser();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureVettedFlowsForUser(prisma, user.id))
    );

    expect(results.every((result) => result.workflows.length === 3)).toBe(true);
    expect(await prisma.workflow.count({ where: { userId: user.id } })).toBe(3);
    expect(await prisma.mcpAccessGrant.count({ where: { userId: user.id } })).toBe(5);
  });

  it("pre-wires only executable tools with draft-only defaults", async () => {
    const user = await createTestUser();
    await prisma.serverRegistration.deleteMany();
    const { workflows } = await ensureVettedFlowsForUser(prisma, user.id);

    const grants = await prisma.mcpAccessGrant.findMany({
      where: { userId: user.id },
      include: { workflow: true, mcpServer: { include: { tools: true } } }
    });
    const identities = grants.map((grant) =>
      `${grant.workflow?.name}:${grant.mcpServer.mcpServerKey}:${grant.mcpServer.mcpToolName}`
    );

    expect(identities.sort()).toEqual([
      "Brief → draft:gmail:create_draft",
      "Research & email me a summary:gmail:create_draft",
      "Research & email me a summary:search:web_search",
      "Research → you choose → email your picks:gmail:create_draft",
      "Research → you choose → email your picks:search:web_search"
    ].sort());
    expect(grants.every((grant) => grant.mcpServer.verificationStatus === "verified")).toBe(true);
    expect(grants.every((grant) => grant.mcpServer.mcpServerKey && grant.mcpServer.mcpToolName)).toBe(true);
    expect(grants.every((grant) => grant.mcpServer.tools.some((tool) => tool.name === grant.mcpServer.mcpToolName))).toBe(true);
    expect(grants.some((grant) => grant.mcpServer.isExternalSend)).toBe(false);
    expect(await prisma.serverRegistration.count({ where: { serverKey: { in: ["gmail", "search"] }, enabled: true } })).toBe(2);
    expect(workflows).toHaveLength(3);
  });

  it("adds send_email only for an opted-in user and keeps it approval-gated", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { sendingEnabled: true } });

    await ensureVettedFlowsForUser(prisma, user.id);
    const sends = await prisma.mcpAccessGrant.findMany({
      where: { userId: user.id, mcpServer: { mcpToolName: "send_email" } },
      include: { workflow: true, mcpServer: true }
    });

    expect(sends.map((grant) => grant.workflow?.name).sort()).toEqual([
      "Research & email me a summary",
      "Research → you choose → email your picks"
    ].sort());
    expect(sends.every((grant) => grant.requiresApproval)).toBe(true);
    expect(sends.every((grant) => grant.mcpServer.isExternalSend)).toBe(true);
  });

  it("encodes the form and choice behavior in the installed agent contracts", async () => {
    const user = await createTestUser();
    await ensureVettedFlowsForUser(prisma, user.id);
    const agents = await prisma.agent.findMany({
      where: { userId: user.id, name: { in: ["Research Email Assistant", "Research Choice Assistant", "Brief Draft Assistant"] } }
    });
    const prompts = new Map(agents.map((agent) => [agent.name, agent.systemPrompt ?? ""]));

    expect(prompts.get("Research Email Assistant")).toContain('"intentType":"form"');
    expect(prompts.get("Research Choice Assistant")).toContain('"intentType":"choice"');
    expect(prompts.get("Research Choice Assistant")).toContain('"maxSelect":3');
    expect(prompts.get("Brief Draft Assistant")).toContain('"audience"');
    expect(prompts.get("Brief Draft Assistant")).toContain('"tone"');
    expect(prompts.get("Brief Draft Assistant")).toContain('"key_point"');
  });
});
