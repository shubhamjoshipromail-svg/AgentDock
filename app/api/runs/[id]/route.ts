import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { recordProductEvent } from "../../../../lib/analytics/product-events";

// Run status + its immutable event timeline + pending approvals. Never selects
// secret columns.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await context.params;
  const run = await prisma.workflowRun.findFirst({
    where: { id, userId: user.id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      approvalRequests: { where: { status: "pending" }, orderBy: { requestedAt: "asc" } },
      workflow: { select: { name: true } }
    }
  });
  if (!run) {
    return NextResponse.json({ message: "Run not found." }, { status: 404 });
  }

  // Funnel: the user is viewing a completed run's deliverable. This GET is polled,
  // so record it at most once per run (only when there is a real deliverable).
  if (run.status === "completed" && run.resultText) {
    const already = await prisma.productEvent.count({ where: { userId: user.id, runId: run.id, event: "deliverable_viewed" } });
    if (already === 0) {
      await recordProductEvent(user.id, "deliverable_viewed", { runId: run.id, workflowId: run.workflowId });
    }
  }

  // Resolve each event's agentId → agent name so the UI stops rendering a
  // generic "Agent/System". agentId is a bare Agent.id (no Prisma relation),
  // so we batch-resolve the distinct ids on this run.
  const agentIds = Array.from(new Set(run.events.map((e) => e.agentId).filter((v): v is string => Boolean(v))));
  const agents = agentIds.length
    ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  const { workflow, events, ...rest } = run;
  const shaped = {
    ...rest,
    workflowName: workflow?.name ?? "Untitled flow",
    events: events.map((e) => ({ ...e, agentName: e.agentId ? nameById.get(e.agentId) ?? null : null }))
  };
  return NextResponse.json({ run: shaped });
}
