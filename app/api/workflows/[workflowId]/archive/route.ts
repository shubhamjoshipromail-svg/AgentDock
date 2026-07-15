import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { TERMINAL_RUN_STATUSES } from "../../../../../lib/runs/terminal";

// POST /api/workflows/:workflowId/archive — soft-delete a flow from the active
// workspace. Historical runs, events, grants, and audit rows remain intact.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });

  const { workflowId } = await params;
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId: user.id },
    select: { id: true, name: true, status: true }
  });
  if (!workflow) return NextResponse.json({ message: "Flow not found." }, { status: 404 });
  if (workflow.status === "archived") return NextResponse.json({ workflow });

  const activeRun = await prisma.workflowRun.findFirst({
    where: {
      userId: user.id,
      workflowId: workflow.id,
      status: { notIn: [...TERMINAL_RUN_STATUSES] }
    },
    select: { id: true }
  });
  if (activeRun) {
    return NextResponse.json(
      { message: "This flow has an active run. Finish or kill that run before archiving the flow." },
      { status: 409 }
    );
  }

  const archived = await prisma.$transaction(async (tx) => {
    const updated = await tx.workflow.update({
      where: { id: workflow.id },
      data: { status: "archived" },
      select: { id: true, name: true, status: true }
    });
    await tx.activityLog.create({
      data: {
        userId: user.id,
        workflowId: workflow.id,
        eventType: "orchestration",
        title: "Flow archived",
        description: `${workflow.name} was archived and hidden from the workspace.`,
        decision: "info",
        costCents: 0,
        metadata: { source: "flow_archive" }
      }
    });
    return updated;
  });

  return NextResponse.json({ workflow: archived });
}
