import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";

const POLL_MS = 1_000;
// How long to keep the SSE connection open when the run is terminal but the
// client hasn't closed yet — gives a final window for the last events.
const TERMINAL_DRAIN_MS = 2_000;

const TERMINAL = new Set(["completed", "halted_cost", "halted_error", "killed"]);

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

      // Prime the stream with existing events.
      await sendInitial();

      // Poll for new events until the run is terminal or client disconnects.
      const interval = setInterval(async () => {
        try {
          await sendInitial();

          const fresh = await prisma.workflowRun.findUnique({
            where: { id: runId },
            select: { status: true }
          });

          if (fresh && TERMINAL.has(fresh.status)) {
            if (!drained) {
              drained = true;
              // Send the terminal-status event so the client can close.
              controller.enqueue(
                sseChunk({ type: "run_terminal", runId, status: fresh.status })
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
