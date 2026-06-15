import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";
import { startRun } from "../../../lib/execution/run-engine";
import { parseJsonBody } from "../../../lib/validation/parse";
import { startRunSchema } from "../../../lib/validation/schemas";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Start a real, governed run for a saved flow. Explicit + auth + daily-cap
// pre-check (which makes ZERO model calls when over the cap).
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in to run a flow." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, startRunSchema);
  if (!parsed.ok) return parsed.response;

  // --- daily run-cost cap: checked BEFORE any provider call ---
  const dailyCap = intEnv("USER_DAILY_RUN_COST_CAP_CENTS", 200);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const spent = await prisma.workflowRun.aggregate({
    _sum: { totalCostCents: true },
    where: { userId: user.id, createdAt: { gte: startOfDay } }
  });
  const todayTotal = spent._sum.totalCostCents ?? 0;
  if (todayTotal >= dailyCap) {
    return NextResponse.json(
      { message: `Daily run budget reached (${todayTotal}/${dailyCap} cents). Try again tomorrow.` },
      { status: 429 }
    );
  }

  const outcome = await startRun(user.id, parsed.data.workflowId);
  if (!outcome.ok) {
    return NextResponse.json({ message: outcome.message }, { status: outcome.status });
  }
  return NextResponse.json({ run: outcome.result }, { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const runs = await prisma.workflowRun.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, status: true, totalCostCents: true, stepCount: true, toolCallCount: true, createdAt: true, endedAt: true }
  });
  return NextResponse.json({ runs });
}
