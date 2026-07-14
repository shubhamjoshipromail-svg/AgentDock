import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { approvalResolveSchema } from "../../../../../lib/validation/schemas";
import { enqueueRunJob, markRunJobFailed } from "../../../../../lib/execution/run-queue";
import { validateIntentResponse } from "../../../../../lib/execution/interaction-intent";
import { recordProductEvent } from "../../../../../lib/analytics/product-events";

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

    // Non-approval interaction intent (choice/form/confirmation): validate the
    // response against the intent payload, store it, and resume the run. Choice is
    // not authorization — a consequential action still hits its own approval intent.
    if (approval.intentType && approval.intentType !== "approval") {
      const validation = validateIntentResponse(approval.intentType, approval.payload, body.response);
      if (!validation.ok) {
        return NextResponse.json({ message: `Invalid response: ${validation.error}` }, { status: 400 });
      }
      const updated = await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: "responded", response: validation.data as Prisma.InputJsonValue, resolvedAt: new Date() },
        include: { workflowRun: true, agent: true }
      });
      const queued = await enqueueRunJob(user.id, approval.workflowRunId);
      return NextResponse.json({
        approvalRequest: updated,
        run: queued.ok ? { runId: approval.workflowRunId, status: queued.status ?? "queued" } : null
      });
    }

    // Approval intent — a status is required.
    if (!body.status) {
      return NextResponse.json({ message: "An approval decision (status) is required." }, { status: 400 });
    }

    // SECURITY INVARIANT — "what you approved is exactly what runs."
    // If the client submits editedArgs, the action that would execute no longer
    // matches the action the approval card displayed and the user consented to.
    // We therefore NEVER execute an edited action directly: any edit routes to
    // the "edited" path (halt + require re-run), regardless of the status the
    // client sent. The edited args are deliberately NOT merged into the pending
    // action's metadata — they must not become executable — but the attempted
    // edit IS recorded on the audit event for transparency. To apply an edit the
    // user re-runs the flow, which re-plans, re-gates, and raises a fresh
    // approval showing the real action, which must itself be approved.
    const editing = Boolean(body.editedArgs && Object.keys(body.editedArgs).length > 0);
    const effectiveStatus: "approved" | "denied" | "edited" = editing ? "edited" : body.status;
    const editedKeys = editing ? Object.keys(body.editedArgs as Record<string, string>) : [];

    const updatedApproval = await prisma.$transaction(async (tx) => {
      const updated = await tx.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: effectiveStatus,
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
          title: `${approval.title} ${effectiveStatus}`,
          description: editing
            ? `User edited the proposed action for "${approval.title}"; the run is halted and must be re-run — edited arguments were not executed.`
            : `User marked "${approval.title}" as ${effectiveStatus}.`,
          decision: effectiveStatus === "edited" ? "info" : effectiveStatus,
          costCents: 0,
          metadata: {
            source: "approval_resolution",
            approvalRequestId: approval.id,
            actionType: approval.actionType,
            // Record WHICH fields were edited (keys only, never values — values
            // may be sensitive, e.g. a recipient), so the audit shows an edit
            // happened without persisting the un-approved payload.
            ...(editing ? { editedArgKeys: editedKeys, edited: true } : {})
          }
        }
      });

      return updated;
    });

    // Funnel: an approval was resolved. `approved` is the activation-critical
    // outcome (a genuine consent to a consequential action). Ids + flag only.
    await recordProductEvent(user.id, "approval_resolved", {
      runId: approval.workflowRunId,
      workflowId: approval.workflowRun.workflowId,
      approved: effectiveStatus === "approved"
    });

    // Chunk 6: only an explicit approval can resume a live run. "edited" is a
    // policy-edit signal, not execution consent.
    // Chunk 7: "edited" no longer leaves the run paused in limbo — it cleanly
    // terminates the paused run (terminal status, honest event) without
    // executing the pending action. The user re-runs the flow to apply the
    // updated policy/grants.
    let run: { runId: string; status: string } | null = null;
    if (approval.workflowRun.status === "paused_for_approval") {
      if (effectiveStatus === "edited") {
        await prisma.$transaction(async (tx) => {
          await tx.workflowRunEvent.create({
            data: {
              workflowRunId: approval.workflowRunId,
              userId: user.id,
              agentId: approval.agentId,
              eventType: "action_blocked",
              title: editing ? "Run halted — action edited" : "Run halted — policy edited",
              description: editing
                ? "The proposed action was edited; the edited arguments were NOT executed and the run is halted. Re-run to raise a fresh approval showing the real action."
                : "Policy edited; pending action not executed; run halted. Re-run to apply the updated policy.",
              decision: "blocked",
              actorType: "human",
              actorId: user.id,
              authorityRef: approval.id,
              schemaVersion: 1,
              metadata: {
                source: "approval_resolution",
                approvalRequestId: approval.id,
                status: "edited",
                executed: false,
                // Keys only, never values — the un-approved payload is not persisted.
                ...(editing ? { editedArgKeys: editedKeys } : {})
              }
            }
          });
          await tx.workflowRun.update({
            where: { id: approval.workflowRunId },
            data: { status: "halted_error", endedAt: new Date() }
          });
        });
        await markRunJobFailed(user.id, approval.workflowRunId, editing ? "Action edited; edited arguments not executed." : "Policy edited; pending action not executed.");
        run = { runId: approval.workflowRunId, status: "halted_error" };
      } else if (effectiveStatus === "denied") {
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
