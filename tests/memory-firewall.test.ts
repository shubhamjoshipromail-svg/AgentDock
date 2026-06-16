import { beforeEach, describe, expect, it } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import { buildStepContext } from "../lib/execution/memory";

const SECRET_TEXT = "BANK-ACCOUNT-9999-SENSITIVE";
const PUBLIC_TEXT = "Public job-search note about AI roles";
const UNGRANTED_TEXT = "OTHER-PARTITION-PRIVATE-CONTENT";

async function scaffold() {
  const user = await createTestUser();
  const agent = await prisma.agent.create({
    data: { userId: user.id, name: "A", category: "c", provider: "p", verified: true, description: "d" }
  });
  const workflow = await prisma.workflow.create({
    data: { userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500, maxRunBudgetCents: 100, approvalMode: "approval_gated" }
  });
  const run = await prisma.workflowRun.create({
    data: { userId: user.id, workflowId: workflow.id, riskLevel: "low", status: "running" }
  });

  async function partition(name: string, sensitivity: "low" | "medium" | "high" | "restricted", content: string) {
    const p = await prisma.memoryPartition.create({
      data: { userId: user.id, name, type: "workflow", sensitivityLevel: sensitivity, description: "d", defaultAccessPolicy: "workflow_scoped" }
    });
    await prisma.memoryItem.create({
      data: { partitionId: p.id, userId: user.id, title: "note", content, sourceType: "agent", sensitivityLevel: sensitivity }
    });
    return p;
  }

  return { user, agent, run, partition };
}

describe("memory firewall — runtime context bounding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("an agent with no grants sees zero memory bytes", async () => {
    const { user, agent, run, partition } = await scaffold();
    await partition("Job Search Memory", "low", PUBLIC_TEXT);
    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).toBe("");
  });

  it("only granted partitions load; an ungranted partition has ZERO bytes in context", async () => {
    const { user, agent, run, partition } = await scaffold();
    const granted = await partition("Job Search Memory", "low", PUBLIC_TEXT);
    await partition("Finance Memory", "high", UNGRANTED_TEXT);
    await prisma.memoryAccessGrant.create({ data: { userId: user.id, partitionId: granted.id, agentId: agent.id, canRead: true } });

    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).toContain(PUBLIC_TEXT);
    expect(ctx).not.toContain(UNGRANTED_TEXT); // zero bytes of the ungranted partition
  });

  it("restricted memory never loads without an explicit grant", async () => {
    const { user, agent, run, partition } = await scaffold();
    await partition("Health Memory", "restricted", SECRET_TEXT);
    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).not.toContain(SECRET_TEXT);
  });

  it("restricted memory loads tagged [restricted] under an explicit grant", async () => {
    const { user, agent, run, partition } = await scaffold();
    const restricted = await partition("Health Memory", "restricted", SECRET_TEXT);
    await prisma.memoryAccessGrant.create({ data: { userId: user.id, partitionId: restricted.id, agentId: agent.id, canRead: true } });

    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).toContain(SECRET_TEXT);
    expect(ctx).toContain("[restricted]");
  });

  it("every read writes an immutable memory_access event with the grant as authority", async () => {
    const { user, agent, run, partition } = await scaffold();
    const granted = await partition("Job Search Memory", "low", PUBLIC_TEXT);
    const grant = await prisma.memoryAccessGrant.create({ data: { userId: user.id, partitionId: granted.id, agentId: agent.id, canRead: true } });

    await buildStepContext(user.id, agent.id, run.id);
    const evs = await prisma.workflowRunEvent.findMany({ where: { workflowRunId: run.id, eventType: "memory_access" } });
    expect(evs).toHaveLength(1);
    expect(evs[0].authorityRef).toBe(grant.id);
    expect(evs[0].memoryPartitionId).toBe(granted.id);
    expect(evs[0].untrusted).toBe(true);
  });

  it("an expired grant does not load its partition", async () => {
    const { user, agent, run, partition } = await scaffold();
    const granted = await partition("Job Search Memory", "low", PUBLIC_TEXT);
    await prisma.memoryAccessGrant.create({
      data: { userId: user.id, partitionId: granted.id, agentId: agent.id, canRead: true, expiresAt: new Date(Date.now() - 1000) }
    });
    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).not.toContain(PUBLIC_TEXT);
  });

  it("requiresApproval memory does not load silently and writes an approval_required event", async () => {
    const { user, agent, run, partition } = await scaffold();
    const granted = await partition("Company Preferences", "medium", PUBLIC_TEXT);
    const grant = await prisma.memoryAccessGrant.create({
      data: { userId: user.id, partitionId: granted.id, agentId: agent.id, canRead: true, requiresApproval: true }
    });

    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).not.toContain(PUBLIC_TEXT);

    const ev = await prisma.workflowRunEvent.findFirstOrThrow({
      where: { workflowRunId: run.id, eventType: "memory_access", decision: "approval_required" }
    });
    expect(ev.authorityRef).toBe(grant.id);
    expect(ev.memoryPartitionId).toBe(granted.id);
  });

  it("revoked memory grants with read disabled do not load", async () => {
    const { user, agent, run, partition } = await scaffold();
    const granted = await partition("Job Search Memory", "low", PUBLIC_TEXT);
    await prisma.memoryAccessGrant.create({
      data: { userId: user.id, partitionId: granted.id, agentId: agent.id, canRead: false, requiresApproval: true }
    });

    const ctx = await buildStepContext(user.id, agent.id, run.id);
    expect(ctx).not.toContain(PUBLIC_TEXT);
  });
});
