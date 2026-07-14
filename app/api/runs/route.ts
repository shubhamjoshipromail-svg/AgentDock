import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";
import { createQueuedRun } from "../../../lib/execution/run-queue";
import { recordRunStarted } from "../../../lib/analytics/product-events";
import { parseJsonBody } from "../../../lib/validation/parse";
import { startRunSchema } from "../../../lib/validation/schemas";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// A short, single-line, self-contained preview of the run deliverable. Computed
// from existing data — never a model call.
function previewText(text: string | null, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// Enqueue a real, governed run for a saved flow. Explicit + auth + daily-cap
// pre-check (which makes ZERO model calls when over the cap). The worker owns
// provider/tool execution so the request is durable and fast.
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

  const outcome = await createQueuedRun(user.id, parsed.data.workflowId);
  if (!outcome.ok) {
    return NextResponse.json({ message: outcome.message }, { status: outcome.status });
  }
  await recordRunStarted(user.id, outcome.result.runId, parsed.data.workflowId);
  return NextResponse.json({ run: outcome.result }, { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const rows = await prisma.workflowRun.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, status: true, totalCostCents: true, stepCount: true, toolCallCount: true,
      resultText: true, createdAt: true, endedAt: true,
      workflow: { select: { name: true } }
    }
  });
  // Board cards (Phase 3) need a flow name and a short, self-contained preview
  // of the deliverable — never the full result text.
  const runs = rows.map(({ workflow, resultText, ...run }) => ({
    ...run,
    resultText,
    workflowName: workflow?.name ?? "Untitled flow",
    resultPreview: previewText(resultText, 140)
  }));
  return NextResponse.json({ runs });
}
