import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";

type ResolveInput = {
  status?: "approved" | "denied" | "edited";
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to resolve approvals." }, { status: 401 });
  }

  const { id } = await context.params;
  let body: ResolveInput;

  try {
    body = (await request.json()) as ResolveInput;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.status || !["approved", "denied", "edited"].includes(body.status)) {
    return NextResponse.json({ message: "Status must be approved, denied, or edited." }, { status: 400 });
  }

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

    return NextResponse.json({ approvalRequest: updatedApproval });
  } catch (error) {
    console.error("Approval resolution failed", error);
    return NextResponse.json({ message: "Unable to resolve approval request." }, { status: 500 });
  }
}
