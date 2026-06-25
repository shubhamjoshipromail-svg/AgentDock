import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { approvalResolveSchema } from "../../../../../lib/validation/schemas";
import { enqueueRunJob, markRunJobFailed } from "../../../../../lib/execution/run-queue";

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
      // If the user edited tool arguments (e.g. filled in the email recipient),
      // merge them into the approval metadata so the run engine uses them.
      if (body.editedArgs && Object.keys(body.editedArgs).length > 0) {
        const existingMeta = (approval.metadata ?? {}) as Record<string, unknown>;
        const existingArgs = (existingMeta.arguments ?? {}) as Record<string, unknown>;
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: {
            metadata: { ...existingMeta, arguments: { ...existingArgs, ...body.editedArgs } } as Prisma.InputJsonObject
          }
        });
      }

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

    // Chunk 6: only an explicit approval can resume a live run. "edited" is a
    // policy-edit signal, not execution consent.
    // Chunk 7: "edited" no longer leaves the run paused in limbo — it cleanly
    // terminates the paused run (terminal status, honest event) without
    // executing the pending action. The user re-runs the flow to apply the
    // updated policy/grants.
    let run: { runId: string; status: string } | null = null;
    if (approval.workflowRun.status === "paused_for_approval") {
      if (body.status === "edited") {
        await prisma.$transaction(async (tx) => {
          await tx.workflowRunEvent.create({
            data: {
              workflowRunId: approval.workflowRunId,
              userId: user.id,
              agentId: approval.agentId,
              eventType: "action_blocked",
              title: "Run halted — policy edited",
              description: "Policy edited; pending action not executed; run halted. Re-run to apply the updated policy.",
              decision: "blocked",
              actorType: "human",
              actorId: user.id,
              authorityRef: approval.id,
              schemaVersion: 1,
              metadata: {
                source: "approval_resolution",
                approvalRequestId: approval.id,
                status: "edited",
                executed: false
              }
            }
          });
          await tx.workflowRun.update({
            where: { id: approval.workflowRunId },
            data: { status: "halted_error", endedAt: new Date() }
          });
        });
        await markRunJobFailed(user.id, approval.workflowRunId, "Policy edited; pending action not executed.");
        run = { runId: approval.workflowRunId, status: "halted_error" };
      } else if (body.status === "denied") {
        await prisma.$transaction(async (tx) => {
          await tx.workflowRunEvent.create({
            data: {
              workflowRunId: approval.workflowRunId,
              userId: user.id,
              agentId: approval.agentId,
              eventType: "action_blocked",
              title: "Approval denied",
              description: "Human denied the requested action. Run halted.",
              decision: "denied",
              actorType: "human",
              actorId: user.id,
              authorityRef: approval.id,
              schemaVersion: 1,
              metadata: {
                source: "approval_resolution",
                approvalRequestId: approval.id,
                status: "denied",
                executed: false
              }
            }
          });
          await tx.workflowRun.update({
            where: { id: approval.workflowRunId },
            data: { status: "halted_error", endedAt: new Date() }
          });
        });
        await markRunJobFailed(user.id, approval.workflowRunId, "Approval denied; pending action not executed.");
        run = { runId: approval.workflowRunId, status: "halted_error" };
      } else {
        const queued = await enqueueRunJob(user.id, approval.workflowRunId);
        run = queued.ok ? { runId: approval.workflowRunId, status: queued.status ?? "queued" } : null;
      }
    }

    return NextResponse.json({ approvalRequest: updatedApproval, run });
  } catch (error) {
    console.error("Approval resolution failed", error);
    return NextResponse.json({ message: "Unable to resolve approval request." }, { status: 500 });
  }
}
