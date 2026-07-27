import { beforeEach, describe, expect, it } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";

const { ensureVettedFlowsForUser, GENERAL_AGENTS, VETTED_FLOW_TEMPLATES } = require("../lib/catalog/vetted-flows");

// ============================================================================
// THE COMPOSITION SPACE IS BOUNDED BY AGENTS, NOT ONLY TOOLS (Chunk 24).
//
// Connecting Calendar and Docs added tools but no agent that knew how to use
// them: all three vetted-flow agents have prompts naming web_search,
// create_draft and send_email. The orchestrator could therefore compose a
// calendar flow and staff it with an agent instructed to send email.
//
// General-purpose agents are role-shaped and tool-agnostic, so what can be
// composed grows with the tool catalog instead of being pinned to three tools.
// ============================================================================

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createTestUser(`agents-${Date.now()}-${Math.random()}@example.com`);
});

describe("general-purpose agents", () => {
  it("every user gets them, independently of any flow", async () => {
    await ensureVettedFlowsForUser(prisma, user.id);

    const names = (
      await prisma.agent.findMany({ where: { userId: user.id }, select: { name: true } })
    ).map((a) => a.name);

    for (const agent of GENERAL_AGENTS) {
      expect(names, `${agent.name} must exist for every user`).toContain(agent.name);
    }
  });

  it("their prompts name NO specific tool, so any tool can be assigned to them", () => {
    // The failure this prevents: an agent whose prompt says "use send_email" will
    // reach for email even when the flow granted it a calendar.
    const toolNames = ["web_search", "create_draft", "send_email", "create_event", "create_doc", "list_events", "append_to_doc"];

    for (const agent of GENERAL_AGENTS) {
      for (const tool of toolNames) {
        expect(
          agent.systemPrompt,
          `${agent.name} hardcodes the tool "${tool}" and cannot staff an arbitrary composition`
        ).not.toContain(tool);
      }
    }
  });

  it("they carry the honesty and ask-once rules the runtime depends on", () => {
    for (const agent of GENERAL_AGENTS) {
      expect(agent.systemPrompt).toMatch(/never claim/i);
      expect(agent.systemPrompt).toMatch(/ask ONCE/i);
      expect(agent.systemPrompt).toMatch(/final envelope/i);
      expect(agent.systemPrompt).toMatch(/AVAILABLE TOOLS/);
    }
  });

  it("they are runnable: a model and a system prompt are both set", async () => {
    await ensureVettedFlowsForUser(prisma, user.id);

    const rows = await prisma.agent.findMany({
      where: { userId: user.id, name: { in: GENERAL_AGENTS.map((a: { name: string }) => a.name) } }
    });
    expect(rows).toHaveLength(GENERAL_AGENTS.length);
    for (const row of rows) {
      // loadRunnable needs both; an agent missing either cannot execute.
      expect(row.systemPrompt, `${row.name} has no system prompt`).toBeTruthy();
      expect(row.model, `${row.name} has no model`).toBeTruthy();
    }
  });

  it("installing twice does not duplicate them", async () => {
    await ensureVettedFlowsForUser(prisma, user.id);
    await ensureVettedFlowsForUser(prisma, user.id);

    for (const agent of GENERAL_AGENTS) {
      const count = await prisma.agent.count({ where: { userId: user.id, name: agent.name } });
      expect(count, `${agent.name} was installed twice`).toBe(1);
    }
  });

  it("they widen the planner's catalog beyond the vetted-flow agents", async () => {
    await ensureVettedFlowsForUser(prisma, user.id);

    const { buildCatalogSnapshot } = await import("../lib/orchestrator/snapshot");
    const snapshot = await buildCatalogSnapshot(user.id, "prepare me for tomorrow's meetings", true);
    const names = snapshot.agents.map((a) => a.name);

    // The planner sees the general agents alongside the flow-specific ones.
    for (const agent of GENERAL_AGENTS) {
      expect(names).toContain(agent.name);
    }
    expect(snapshot.agents.length).toBeGreaterThan(VETTED_FLOW_TEMPLATES.length);
  });
});
