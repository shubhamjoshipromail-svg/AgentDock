import { NextResponse } from "next/server";

import { prisma } from "../../../lib/prisma";
import { WORKER_HEARTBEAT_STALE_MS } from "../../../lib/execution/run-queue";

// Liveness/readiness probe. Intentionally UNAUTHENTICATED so a load balancer or
// uptime monitor can hit it, and deliberately leaks nothing about users — only
// process/infrastructure health. Returns:
//   200 when the web app is up AND Postgres is reachable;
//   503 when the database cannot be reached (app is up enough to answer, but not
//       ready to serve).
// The worker's liveness is reported as a FIELD, not as the endpoint's status: the
// web app can be healthy while the run executor is down, and an operator/monitor
// should alert on `worker.ok` separately (the worker is a distinct process).
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  // Worker liveness from the most recent heartbeat (best-effort; never fails the
  // probe on its own). Stale or absent → worker reported not-ok.
  let worker: { ok: boolean; lastSeenAt: string | null; staleSeconds: number | null } = {
    ok: false,
    lastSeenAt: null,
    staleSeconds: null
  };
  if (dbOk) {
    try {
      const latest = await prisma.workerHeartbeat.findFirst({
        orderBy: { lastSeenAt: "desc" },
        select: { lastSeenAt: true }
      });
      if (latest?.lastSeenAt) {
        const ageMs = Date.now() - latest.lastSeenAt.getTime();
        worker = {
          ok: ageMs <= WORKER_HEARTBEAT_STALE_MS,
          lastSeenAt: latest.lastSeenAt.toISOString(),
          staleSeconds: Math.round(ageMs / 1000)
        };
      }
    } catch {
      // Leave worker as not-ok; the DB check already reflects reachability.
    }
  }

  const body = {
    ok: dbOk,
    db: { ok: dbOk },
    worker,
    checkDurationMs: Date.now() - startedAt,
    time: new Date().toISOString()
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
