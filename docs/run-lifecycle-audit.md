# Run Lifecycle Audit (Chunk 18 Phase 0)

Two live bugs — "double requests" (duplicate events/approvals on resume) and
"keeps running until I kill it" (leaky UI polling). This audits the pause→resume
path and the workspace's run subscription so the fixes are surgical.

## The pause → resume path

**Pause.** In `runStep`, an `approval_required` gate decision creates an
`ApprovalRequest` (`run-engine.ts` ~678) whose `metadata` captures the paused
call: `{ toolName, serverId, action, input, arguments, seedResults, handoffContent }`,
plus `stepIndex = agent.index`. The run is set `paused_for_approval` and the step
returns `{ kind: "paused" }`.

**Resume.** The approval-resolve route (`app/api/approvals/[id]/resolve/route.ts`)
does NOT resume directly — on approve it `enqueueRunJob` (re-queues the RunJob);
on deny/edit it `markRunJobFailed`. The **worker** (`run-queue.ts` ~259) claims the
re-queued job, sees `status === "paused_for_approval"`, and calls
`resumeRunFromLatestApproval` → `resumeAfterApproval(userId, latestApprovalId, true)`.
`resumeAfterApproval` rebuilds ctx and calls
`drive(ctx, fromStep = approval.stepIndex, meta.seedResults, meta.handoffContent, approvedCall)`.

## What replays today (the "double requests")

`drive` restarts the agent loop at `fromStep` and `runStep` re-runs the paused
step's *preamble* before executing the approved call:

1. **Duplicate `a2a_handoff` event.** `drive` re-emits the handoff event at
   `fromStep` (`run-engine.ts` ~1014) whenever `firstStepHandoff` is set — but that
   handoff was already emitted on the first pass before the pause. → duplicate row.
2. **Duplicate `memory_access` events.** `runStep` calls `buildStepContext`
   (`memory.ts` ~28/46) again on resume, re-reading the same partitions and
   re-appending `memory_access` events that already happened pre-pause.
3. **The approved tool itself does NOT double-execute** — `executeApprovedTool`
   runs the captured `approvedCall` directly (no model re-decide), and the
   idempotency guard (`${runId}:a${agentIndex}:t${toolIter}`) skips a real
   external send that already fired. This part is already correct; keep it.

**Duplicate approval (the second-request bug).** `ApprovalRequest` has **no
uniqueness** on `(workflowRunId, stepIndex, toolName)` — only plain indexes
(`schema.prisma` ~463-465). So any path that re-reaches the gate for the same
step+tool creates a *second* pending approval:
- a reclaimed/retried job whose `stepCursor` is behind the paused step re-runs
  `executeExistingRun` from that cursor and hits the same `approval_required` gate
  again → `approvalRequest.create` fires a second time;
- the step-cursor is **agent-index coarse** (`fromStep`/`stepCursor` = agent
  index), so it cannot express "the handoff + memory + gate for this step already
  happened; only the approved tool + forward synthesis remain." Resume therefore
  replays the whole step preamble instead of continuing sub-step.

## The "keeps running" bug (UI)

`FlowWorkspace.tsx` subscribes to run state by **polling**:
- `handleRun` opens a `setInterval(…, 2000)` and stores `pollId`;
- `handleApprove` reads a **stale `pollId` closure** and can open a *second*
  interval (stacked pollers) while the first still runs;
- one clear path (`handleKill`) clears the interval but does not always
  `setPollId(null)`;
- the terminal set is **hardcoded** in the poller
  (`["completed","halted_error","halted_cost","killed"]`) — any other terminal
  status (or a new one) never stops the loop, so the Run button stays "Running…"
  and the UI shows a live run forever until the user kills it.

Chunk 11 already ships an **SSE endpoint** (`app/api/runs/[id]/stream/route.ts`)
that streams status + events; `FlowWorkspace` does not use it (ControlPlane still
carries the TODO-poll note).

## Fix plan (Parts A)

- **Phase 1 — idempotent resume.** Make the step-cursor **sub-step** (know that
  handoff/memory/gate already happened); on resume, execute the approved call and
  continue **forward** without re-emitting the handoff or re-reading memory. Add a
  DB uniqueness so a second pending/approved approval for the same step+tool is
  impossible (not just improbable). Keep the tool idempotency guard.
- **Phase 2 — SSE, not polling.** `FlowWorkspace` subscribes to the run SSE
  stream (one effect keyed on `runId`, single subscription, reconnect-with-catch-up),
  removes `setInterval`, and derives `running`/terminal from **server-declared**
  terminal statuses exported from one place — no hardcoded lists, no stacked
  pollers, no zombie "running."

This lifecycle spine (idempotent pause/resume + live truth) is what Part B's
unified interaction primitive (approval as one intent type) is built on.
