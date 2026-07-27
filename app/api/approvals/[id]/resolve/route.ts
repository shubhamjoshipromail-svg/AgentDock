import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { approvalResolveSchema, type ApprovalResolveInput } from "../../../../../lib/validation/schemas";
import { enqueueRunJob, markRunJobFailed } from "../../../../../lib/execution/run-queue";
import { validateIntentResponse } from "../../../../../lib/execution/interaction-intent";
import { recordProductEvent } from "../../../../../lib/analytics/product-events";
import { runIdempotently } from "../../../../../lib/idempotency";

// ============================================================================
// RESOLUTION IS SINGLE-SHOT.
//
// An approval row is a record of human consent, so resolving it must be a
// one-way transition out of `pending` and nothing else. Two guarantees:
//
//  1. STATUS PRECONDITION (the invariant). Every write is a conditional update
//     predicated on `status = pending`, so the database — not a prior read —
//     decides who wins. A resolve of an already-resolved intent changes nothing
//     and returns 409. This is what stops a DENIED approval being replayed into
//     APPROVED, and stops two concurrent resolves both "succeeding".
//
//  2. IDEMPOTENCY (the ergonomics). An optional Idempotency-Key lets a genuine
//     retry of the SAME logical request replay the original response instead of
//     colliding with (1). Two distinct user actions carry two distinct keys and
//     are still governed by (1).
//
// Never replace (1) with an application-level read-then-write: that is the exact
// race this closes.
// ============================================================================

const CONFLICT = (message: string) => NextResponse.json({ message }, { status: 409 });

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

  // The key is optional: without it the status precondition alone still makes
  // resolution single-shot; with it, a retried request replays rather than 409s.
  if (request.headers.get("idempotency-key")) {
    return runIdempotently({
      request,
      userId: user.id,
      scope: "approval_resolve",
      input: { approvalId: id, ...body },
      work: () => resolveOnce(user.id, id, body)
    });
  }

  return resolveOnce(user.id, id, body);
}

async function resolveOnce(userId: string, id: string, body: ApprovalResolveInput): Promise<NextResponse> {
  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id,
        userId
      },
      include: {
        workflowRun: true,
        agent: true
      }
    });

    if (!approval) {
      return NextResponse.json({ message: "Approval request not found for the signed-in user." }, { status: 404 });
    }

    // Fail fast on an obviously-resolved row. This is a courtesy, NOT the
    // guarantee — the conditional updates below are what actually decide.
    if (approval.status !== "pending") {
      return CONFLICT(`This request was already ${approval.status}. Resolutions cannot be changed or replayed.`);
    }

    // Non-approval interaction intent (choice/form/confirmation): validate the
    // response against the intent payload, store it, and resume the run. Choice is
    // not authorization — a consequential action still hits its own approval intent.
    if (approval.intentType && approval.intentType !== "approval") {
      const validation = validateIntentResponse(approval.intentType, approval.payload, body.response);
      if (!validation.ok) {
        return NextResponse.json({ message: `Invalid response: ${validation.error}` }, { status: 400 });
      }

      // Conditional: only a still-pending intent may be answered, so a second
      // submission can never overwrite the answer the human actually gave.
      const claimed = await prisma.approvalRequest.updateMany({
        where: { id: approval.id, userId, status: "pending" },
        data: { status: "responded", response: validation.data as Prisma.InputJsonValue, resolvedAt: new Date() }
      });
      if (claimed.count === 0) {
        return CONFLICT("This request has already been answered.");
      }

      const updated = await prisma.approvalRequest.findUnique({
        where: { id: approval.id },
        include: { workflowRun: true, agent: true }
      });
      const queued = await enqueueRunJob(userId, approval.workflowRunId);
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

    // Claim the resolution and write its audit row atomically. If the conditional
    // update matches nothing, someone else already resolved this and we abort
    // WITHOUT writing an ActivityLog row or emitting a funnel event.
    const updatedApproval = await prisma.$transaction(async (tx) => {
      const claimed = await tx.approvalRequest.updateMany({
        where: { id: approval.id, userId, status: "pending" },
        data: {
          status: effectiveStatus,
          resolvedAt: new Date()
        }
      });
      if (claimed.count === 0) return null;

      await tx.activityLog.create({
        data: {
          userId,
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

      return tx.approvalRequest.findUnique({
        where: { id: approval.id },
        include: { workflowRun: true, agent: true }
      });
    });

    if (!updatedApproval) {
      return CONFLICT("This request has already been resolved. Resolutions cannot be changed or replayed.");
    }

    // Funnel: an approval was resolved. `approved` is the activation-critical
    // outcome (a genuine consent to a consequential action). Ids + flag only.
    await recordProductEvent(userId, "approval_resolved", {
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
              userId,
              agentId: approval.agentId,
              eventType: "action_blocked",
              title: editing ? "Run halted — action edited" : "Run halted — policy edited",
              description: editing
                ? "The proposed action was edited; the edited arguments were NOT executed and the run is halted. Re-run to raise a fresh approval showing the real action."
                : "Policy edited; pending action not executed; run halted. Re-run to apply the updated policy.",
              decision: "blocked",
              actorType: "human",
              actorId: userId,
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
        await markRunJobFailed(userId, approval.workflowRunId, editing ? "Action edited; edited arguments not executed." : "Policy edited; pending action not executed.");
        run = { runId: approval.workflowRunId, status: "halted_error" };
      } else if (effectiveStatus === "denied") {
        await prisma.$transaction(async (tx) => {
          await tx.workflowRunEvent.create({
            data: {
              workflowRunId: approval.workflowRunId,
              userId,
              agentId: approval.agentId,
              eventType: "action_blocked",
              title: "Approval denied",
              description: "Human denied the requested action. Run halted.",
              decision: "denied",
              actorType: "human",
              actorId: userId,
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
        await markRunJobFailed(userId, approval.workflowRunId, "Approval denied; pending action not executed.");
        run = { runId: approval.workflowRunId, status: "halted_error" };
      } else {
        const queued = await enqueueRunJob(userId, approval.workflowRunId);
        run = queued.ok ? { runId: approval.workflowRunId, status: queued.status ?? "queued" } : null;
      }
    }

    return NextResponse.json({ approvalRequest: updatedApproval, run });
  } catch (error) {
    console.error("Approval resolution failed", error);
    return NextResponse.json({ message: "Unable to resolve approval request." }, { status: 500 });
  }
}
