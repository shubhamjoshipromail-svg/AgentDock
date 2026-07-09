import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";
import { TERMINAL_RUN_STATUSES } from "../../../lib/runs/terminal";

// GET /api/approvals — every intent currently waiting on the human, across ALL
// runs. This is the ONE source the banner, the attention queue, and the focused
// interaction window read (the Chunk 18 table) — there is no separate
// notification store that can drift from run truth.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to view pending approvals." }, { status: 401 });
  }

  const rows = await prisma.approvalRequest.findMany({
    where: {
      userId: user.id,
      status: "pending",
      // An intent whose run already ended (killed mid-pause, halted on cost)
      // is not actionable — never summon the user to a dead run.
      workflowRun: { status: { notIn: [...TERMINAL_RUN_STATUSES] } }
    },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      intentType: true,
      payload: true,
      title: true,
      description: true,
      requestedAt: true,
      workflowRun: {
        select: {
          id: true,
          status: true,
          workflow: { select: { id: true, name: true } }
        }
      },
      agent: { select: { name: true } }
    }
  });

  return NextResponse.json({
    intents: rows.map((r) => ({
      id: r.id,
      intentType: r.intentType,
      payload: r.payload,
      title: r.title,
      description: r.description,
      requestedAt: r.requestedAt.toISOString(),
      runId: r.workflowRun.id,
      runStatus: r.workflowRun.status,
      flowId: r.workflowRun.workflow?.id ?? null,
      flowName: r.workflowRun.workflow?.name ?? "Untitled flow",
      agentName: r.agent?.name ?? null
    }))
  });
}
