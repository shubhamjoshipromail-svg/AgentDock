import { prisma } from "../prisma";

// The activation funnel. Each value is a stage a user can reach, in rough order.
// These names are the ONLY things recorded besides ids + timestamps — no user
// content ever enters a product event.
export const PRODUCT_EVENTS = [
  "signup",
  "key_added",
  "flow_planned",
  "grant_created",
  "run_started",
  "run_started_repeat",
  "approval_shown",
  "approval_resolved",
  "action_executed_real",
  "run_completed",
  "deliverable_viewed"
] as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

// The only fields a caller may attach. Strictly ids + a non-PII decision flag —
// no goals, emails, bodies, or tool arguments. The type makes leaking content a
// compile error, not a review catch.
type ProductEventContext = {
  runId?: string | null;
  workflowId?: string | null;
  // A small non-PII decision flag (e.g. approval outcome). Never user content.
  approved?: boolean;
};

// Record one funnel event. BEST-EFFORT: analytics must never break, slow, or
// fail a real user action, so this swallows all errors and only ever writes the
// id/flag fields above.
export async function recordProductEvent(
  userId: string,
  event: ProductEventName,
  ctx: ProductEventContext = {}
): Promise<void> {
  try {
    const metadata: Record<string, boolean> = {};
    if (typeof ctx.approved === "boolean") metadata.approved = ctx.approved;
    await prisma.productEvent.create({
      data: {
        userId,
        event,
        runId: ctx.runId ?? null,
        workflowId: ctx.workflowId ?? null,
        metadata
      }
    });
  } catch {
    // Never let analytics bookkeeping affect the user's request.
  }
}

// Record `run_started`, and additionally `run_started_repeat` when this user has
// started a run before — so "came back and ran it again" is a first-class signal.
export async function recordRunStarted(userId: string, runId: string, workflowId?: string | null): Promise<void> {
  try {
    const priorStarts = await prisma.productEvent.count({ where: { userId, event: "run_started" } });
    await recordProductEvent(userId, "run_started", { runId, workflowId });
    if (priorStarts > 0) {
      await recordProductEvent(userId, "run_started_repeat", { runId, workflowId });
    }
  } catch {
    // best-effort
  }
}

// --- Founder-facing funnel summary ------------------------------------------

export type UserFunnel = {
  userId: string;
  counts: Record<string, number>;
  // ACTIVATION: for one run, the user resolved an approval as approved, a real
  // action executed, and the run completed. This is the metric that represents
  // genuine value delivered — not signup, not "opened the dashboard".
  activated: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
};

// Per-user funnel counts + activation, computed from the append-only event log.
// Ids only — safe to surface to the founder as adoption evidence.
export async function computeFunnel(): Promise<{ users: UserFunnel[]; totals: Record<string, number>; activatedUsers: number }> {
  const events = await prisma.productEvent.findMany({
    select: { userId: true, event: true, runId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" }
  });

  const byUser = new Map<string, { counts: Record<string, number>; runs: Map<string, Set<string>>; approvedRuns: Set<string>; first: Date; last: Date }>();
  const totals: Record<string, number> = {};

  for (const e of events) {
    totals[e.event] = (totals[e.event] ?? 0) + 1;
    let u = byUser.get(e.userId);
    if (!u) {
      u = { counts: {}, runs: new Map(), approvedRuns: new Set(), first: e.createdAt, last: e.createdAt };
      byUser.set(e.userId, u);
    }
    u.counts[e.event] = (u.counts[e.event] ?? 0) + 1;
    if (e.createdAt < u.first) u.first = e.createdAt;
    if (e.createdAt > u.last) u.last = e.createdAt;
    if (e.runId) {
      if (!u.runs.has(e.runId)) u.runs.set(e.runId, new Set());
      u.runs.get(e.runId)!.add(e.event);
      const approved = (e.metadata as { approved?: boolean } | null)?.approved === true;
      if (e.event === "approval_resolved" && approved) u.approvedRuns.add(e.runId);
    }
  }

  const users: UserFunnel[] = [];
  let activatedUsers = 0;
  for (const [userId, u] of Array.from(byUser.entries())) {
    // Activation: a single run carries approval_resolved(approved) AND
    // action_executed_real AND run_completed.
    let activated = false;
    for (const [runId, stages] of Array.from(u.runs.entries())) {
      if (u.approvedRuns.has(runId) && stages.has("action_executed_real") && stages.has("run_completed")) {
        activated = true;
        break;
      }
    }
    if (activated) activatedUsers += 1;
    users.push({
      userId,
      counts: u.counts,
      activated,
      firstSeen: u.first.toISOString(),
      lastSeen: u.last.toISOString()
    });
  }

  return { users, totals, activatedUsers };
}

// Founder allow-list for the funnel summary route. Comma-separated emails in
// FOUNDER_EMAILS. Empty ⇒ nobody may read it (safe default: the route 404s).
export function isFounderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
