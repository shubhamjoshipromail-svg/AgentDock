import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { isTerminalRunStatus } from "../../../../../lib/runs/terminal";

const POLL_MS = 1_000;
// How long to keep the SSE connection open when the run is terminal but the
// client hasn't closed yet — gives a final window for the last events.
const TERMINAL_DRAIN_MS = 2_000;

function sseChunk(data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(`data: ${json}\n\n`);
}

/**
 * GET /api/runs/:id/stream — SSE event stream for a single run.
 *
 * Returns an append-only stream of WorkflowRunEvent rows as they are created
 * by the worker engine. The initial payload includes all existing events;
 * subsequent updates arrive as new-line-delimited JSON.
 *
 * The stream closes when the run reaches a terminal status (completed,
 * halted_cost, halted_error, killed). The existing polling-based Control
 * board continues to work as a fallback — this endpoint is additive.
 *
 * Query params:
 *   cursor=<eventId>  Start streaming after a specific event ID (for reconnect).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id: runId } = await context.params;

  // Verify the run belongs to this user.
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId: user.id },
    select: { id: true, status: true }
  });
  if (!run) {
    return NextResponse.json({ message: "Run not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");

  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      let lastEventId = cursorParam ?? undefined;
      let drained = false;

      const sendInitial = async () => {
        // Send all events after the cursor (or all if no cursor).
        const events = await prisma.workflowRunEvent.findMany({
          where: {
            workflowRunId: runId,
            ...(lastEventId ? { id: { not: { equals: lastEventId } } } : {}),
            ...(lastEventId ? { createdAt: { gte: await getEventCreatedAt(lastEventId) } } : {})
          },
          orderBy: { createdAt: "asc" }
        });
        for (const ev of events) {
          if (ev.id === lastEventId) continue;
          controller.enqueue(sseChunk(ev));
          lastEventId = ev.id;
        }
      };

      // Emit a run snapshot: the authoritative run status + counts + result +
      // any pending approval/intent surfaces. The client renders run state from
      // this (never inventing it), so it stays truthful and stops on its own.
      const sendSnapshot = async () => {
        const fresh = await prisma.workflowRun.findUnique({
          where: { id: runId },
          select: { status: true, totalCostCents: true, stepCount: true, toolCallCount: true, resultText: true }
        });
        if (!fresh) return null;
        const approvals = await prisma.approvalRequest.findMany({
          where: { workflowRunId: runId, status: "pending" },
          orderBy: { requestedAt: "asc" },
          select: { id: true, title: true, description: true, status: true }
        });
        controller.enqueue(sseChunk({
          type: "run_snapshot",
          runId,
          status: fresh.status,
          totalCostCents: fresh.totalCostCents,
          stepCount: fresh.stepCount,
          toolCallCount: fresh.toolCallCount,
          resultText: fresh.resultText ?? null,
          approvals
        }));
        return fresh.status;
      };

      // Prime the stream with existing events + a first snapshot.
      await sendInitial();
      await sendSnapshot();

      // Poll for new events until the run is terminal or client disconnects.
      const interval = setInterval(async () => {
        try {
          await sendInitial();
          const status = await sendSnapshot();

          if (status && isTerminalRunStatus(status)) {
            if (!drained) {
              drained = true;
              // Send the terminal-status event so the client can close.
              controller.enqueue(
                sseChunk({ type: "run_terminal", runId, status })
              );
              setTimeout(() => {
                try { controller.close(); } catch { /* already closed */ }
              }, TERMINAL_DRAIN_MS);
              clearInterval(interval);
            }
          }
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch { /* already closed */ }
        }
      }, POLL_MS);

      // Respect client disconnect.
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    }
  });

  async function getEventCreatedAt(id: string): Promise<Date> {
    const ev = await prisma.workflowRunEvent.findUnique({
      where: { id },
      select: { createdAt: true }
    });
    return ev?.createdAt ?? new Date(0);
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no" // nginx: don't buffer SSE
    }
  });
}
