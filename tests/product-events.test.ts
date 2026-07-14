import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import {
  recordProductEvent,
  recordRunStarted,
  computeFunnel,
  isFounderEmail
} from "../lib/analytics/product-events";
import { GET as funnelRoute } from "../app/api/admin/funnel/route";

// Seed the full activation chain for one run of a user.
async function seedActivatedRun(userId: string, runId: string, workflowId: string) {
  await recordProductEvent(userId, "run_started", { runId, workflowId });
  await recordProductEvent(userId, "approval_shown", { runId });
  await recordProductEvent(userId, "approval_resolved", { runId, approved: true });
  await recordProductEvent(userId, "action_executed_real", { runId });
  await recordProductEvent(userId, "run_completed", { runId });
}

describe("product events — activation funnel", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
    delete process.env.FOUNDER_EMAILS;
  });
  afterEach(() => {
    delete process.env.FOUNDER_EMAILS;
  });

  it("records ids + timestamps only — never user content (no PII leak)", async () => {
    const user = await createTestUser();
    await recordProductEvent(user.id, "approval_resolved", { runId: "11111111-1111-1111-1111-111111111111", approved: true });

    const rows = await prisma.productEvent.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.event).toBe("approval_resolved");
    expect(row.runId).toBe("11111111-1111-1111-1111-111111111111");
    // Metadata may hold ONLY the non-PII decision flag — no free text/content.
    expect(Object.keys(row.metadata as object).sort()).toEqual(["approved"]);
    expect((row.metadata as { approved: boolean }).approved).toBe(true);
  });

  it("run_started_repeat fires only on the second and later runs", async () => {
    const user = await createTestUser();
    await recordRunStarted(user.id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    await recordRunStarted(user.id, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    const starts = await prisma.productEvent.count({ where: { userId: user.id, event: "run_started" } });
    const repeats = await prisma.productEvent.count({ where: { userId: user.id, event: "run_started_repeat" } });
    expect(starts).toBe(2);
    expect(repeats).toBe(1);
  });

  it("activation requires approval_resolved(approved) + action_executed_real + run_completed on the SAME run", async () => {
    const activated = await createTestUser("activated@example.com");
    const partial = await createTestUser("partial@example.com");

    await seedActivatedRun(activated.id, "cccccccc-cccc-cccc-cccc-cccccccccccc", "dddddddd-dddd-dddd-dddd-dddddddddddd");

    // `partial` approved and completed a run, but no real action executed → NOT activated.
    await recordProductEvent(partial.id, "run_started", { runId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" });
    await recordProductEvent(partial.id, "approval_resolved", { runId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", approved: true });
    await recordProductEvent(partial.id, "run_completed", { runId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" });

    const funnel = await computeFunnel();
    const a = funnel.users.find((u) => u.userId === activated.id);
    const p = funnel.users.find((u) => u.userId === partial.id);
    expect(a?.activated).toBe(true);
    expect(p?.activated).toBe(false);
    expect(funnel.activatedUsers).toBe(1);
  });

  it("a DENIED approval does not activate even with a real action + completion", async () => {
    const user = await createTestUser("denied@example.com");
    const runId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await recordProductEvent(user.id, "approval_resolved", { runId, approved: false });
    await recordProductEvent(user.id, "action_executed_real", { runId });
    await recordProductEvent(user.id, "run_completed", { runId });

    const funnel = await computeFunnel();
    expect(funnel.users.find((u) => u.userId === user.id)?.activated).toBe(false);
  });

  it("isFounderEmail respects the FOUNDER_EMAILS allow-list", () => {
    process.env.FOUNDER_EMAILS = "founder@example.com, boss@example.com";
    expect(isFounderEmail("founder@example.com")).toBe(true);
    expect(isFounderEmail("FOUNDER@example.com")).toBe(true); // case-insensitive
    expect(isFounderEmail("someone@example.com")).toBe(false);
    expect(isFounderEmail(null)).toBe(false);
    delete process.env.FOUNDER_EMAILS;
    expect(isFounderEmail("founder@example.com")).toBe(false); // empty ⇒ nobody
  });

  it("funnel route 404s for a non-founder and returns the summary for a founder", async () => {
    const founder = await createTestUser("founder@example.com");
    const other = await createTestUser("nosy@example.com");
    await seedActivatedRun(founder.id, "12121212-1212-1212-1212-121212121212", "34343434-3434-3434-3434-343434343434");
    process.env.FOUNDER_EMAILS = "founder@example.com";

    // Non-founder: 404 (existence not disclosed).
    setCurrentUser(other);
    const denied = await funnelRoute();
    expect(denied.status).toBe(404);

    // Founder: 200 with the funnel.
    setCurrentUser(founder);
    const ok = await funnelRoute();
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.activatedUsers).toBe(1);
    expect(body.totals.run_completed).toBe(1);
    expect(Array.isArray(body.stages)).toBe(true);

    setCurrentUser(null);
  });
});
