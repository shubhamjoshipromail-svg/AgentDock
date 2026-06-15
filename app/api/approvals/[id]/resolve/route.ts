import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { approvalResolveSchema } from "../../../../../lib/validation/schemas";
import { resumeAfterApproval } from "../../../../../lib/execution/run-engine";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to resolve approvals." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = await parseJsonBody(request, approvalResolveSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id,
        userId: user.id
      },
      include: {
        workflowRun: true,
        agent: true
      }
    });

    if (!approval) {
      return NextResponse.json({ message: "Approval request not found for the signed-in user." }, { status: 404 });
    }

    const updatedApproval = await prisma.$transaction(async (tx) => {
      const updated = await tx.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: body.status,
          resolvedAt: new Date()
        },
        include: {
          workflowRun: true,
          agent: true
        }
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: approval.workflowRun.workflowId,
          workflowRunId: approval.workflowRunId,
          agentId: approval.agentId,
          eventType: "approval_requested",
          title: `${approval.title} ${body.status}`,
          description: `User marked "${approval.title}" as ${body.status}.`,
          decision: body.status === "edited" ? "info" : body.status,
          costCents: 0,
          metadata: {
            source: "approval_resolution",
            approvalRequestId: approval.id,
            actionType: approval.actionType
          }
        }
      });

      return updated;
    });

    // Chunk 4: if this approval pauses a real run, resume (approve/edited) or
    // halt (deny) the live run from the paused step.
    let run: { runId: string; status: string } | null = null;
    if (approval.workflowRun.status === "paused_for_approval") {
      run = await resumeAfterApproval(user.id, approval.id, body.status !== "denied");
    }

    return NextResponse.json({ approvalRequest: updatedApproval, run });
  } catch (error) {
    console.error("Approval resolution failed", error);
    return NextResponse.json({ message: "Unable to resolve approval request." }, { status: 500 });
  }
}
