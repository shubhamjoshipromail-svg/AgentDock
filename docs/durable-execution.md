# Durable Run Execution

Run execution moved from the synchronous API request handler to a **durable worker/job queue** backed by Postgres. This document describes the execution model, guarantees, and the sandbox boundary.

## Architecture

```
┌──────────┐   POST /api/runs    ┌──────────┐
│  Client  │ ──────────────────→ │  API      │
│  (UI)    │ ←── polls/SSE ───── │  (Next.js)│
└──────────┘                     └────┬─────┘
                                      │ INSERT RunJob (status=queued)
                                      ▼
┌──────────────────────────────────────────────────────┐
│  Postgres Queue (run_jobs table)                      │
│  - queued → running → paused → completed/failed/killed│
│  - claimed by one worker at a time (lease)            │
│  - expired leases → reclaimable                       │
└────────────────────┬─────────────────────────────────┘
                     │ SELECT … FOR UPDATE SKIP LOCKED
                     ▼
┌──────────────────────────────────────────────────────┐
│  Worker Process (npm run worker)                      │
│  - Claims jobs with per-user concurrency bound        │
│  - Heartbeats every leaseMs/3                         │
│  - Invokes the existing run engine (drive)            │
│  - Gate / orchestration / caps / kill unchanged       │
└────────────────────┬─────────────────────────────────┘
                     │ calls executeAllowedTool(…)
                     ▼
┌──────────────────────────────────────────────────────┐
│  Sandbox Seam (callMcpTool / getExecutor)             │
│  - Tool execution boundary                            │
│  - Today: in-process MCP client / registry            │
│  - Future: containerized/isolated executor            │
└──────────────────────────────────────────────────────┘
```

## Job lifecycle

```
queued → running → completed
              ↓
           paused (paused_for_approval)
              ↓
           running (resumed after approval)
              ↓
           completed / failed / killed
```

A `RunJob` row tracks:
- `status` — where in the lifecycle the job is
- `claimedBy` — which worker owns the lease
- `leaseExpiresAt` — when the lease expires (dead worker → reclaimable)
- `heartbeatAt` — last heartbeat timestamp
- `attemptCount` — how many times the job has been attempted
- `stepCursor` — the index of the next agent to execute (crash recovery)
- `lastError` — why the last attempt failed

## Queue mechanism

**Postgres-backed durable queue** using `SELECT … FOR UPDATE SKIP LOCKED`. No Redis or external broker — Postgres suffices for the current scale (safety concurrency bound, not a throughput feature).

**Why Postgres?**
- No new infrastructure — everything is already in Postgres
- `FOR UPDATE SKIP LOCKED` is well-tested for job queues
- Durable by default (WAL, not in-memory)
- Co-located with the run/event/approval data — single transaction boundary for enqueue + run creation

## Crash recovery guarantees

1. **Lease expiration**: A job whose `leaseExpiresAt` has passed (worker died) is eligible for re-claim by any worker.

2. **Step cursor**: After each agent step completes, the `stepCursor` is advanced. A reclaimed job resumes from the last completed step — completed agents are never re-executed.

3. **No orphaned runs**: A reclaimed job is always driven to a terminal status (completed, halted_error, killed). A paused run stays paused — it is never auto-executed on reclaim.

4. **Idempotent external actions**: Before any real external-send tool call (send_email, payment, etc.), the engine records an idempotency key (`{runId}:a{agentIndex}:t{toolIter}`) in the event metadata. On retry after a crash, the engine checks for a prior execution with the same key and skips re-execution — **an external action is never double-fired**.

5. **Approval survives reclaim**: A run paused for approval that gets reclaimed stays paused. It does not execute without explicit human approval.

6. **Kill survives reclaim**: A killed run that gets reclaimed terminates immediately — no steps are re-executed.

## Concurrency bound

The `claimNextRunJob` query enforces a **per-user concurrency cap** (default: 1) — a safety bound, not a throughput feature. A user cannot exceed N concurrent running jobs. Over-cap jobs stay `queued` until a running job completes.

Configurable via `WORKER_PER_USER_CONCURRENCY` env var.

## Event streaming (SSE)

`GET /api/runs/:id/stream` provides a Server-Sent Events stream of run events as they are created by the worker. The initial payload includes all existing events; subsequent updates arrive as new-line-delimited JSON. The stream closes when the run reaches a terminal status.

The existing polling-based Control board (`GET /api/runs/:id`) continues to work as a fallback — streaming is additive.

## Sandbox boundary

The **single seam** where an isolated/sandboxed executor will slot in is the `callMcpTool` call inside `executeAllowedTool` in `lib/execution/run-engine.ts`. The boundary is marked with a comment block.

What stays on the **trusted side** (never moves into the sandbox):
- The policy gate (`authorizeToolCall`)
- Cap enforcement (cost, steps, tool calls, wall clock)
- Kill switch boundary checks
- Memory firewall
- Idempotency guard
- Audit event recording
- Provider/model management
- Orchestration (agent sequencing, handoff)

What runs **inside the sandbox** (future):
- Tool I/O (network, file system, subprocess)
- MCP server communication
- Untrusted content processing
- Tool-specific auth injection (scoped, per-invocation)

The sandbox receives only: `serverKey`, `toolName`, `input` (structured arguments), and a scoped auth token. No gate logic, no credential-broker logic, no policy decisions move into the sandbox.

## Running the worker

```bash
# Start the Next.js dev server (UI + API)
npm run dev

# In a separate terminal, start the worker
npm run worker
```

Environment variables:
- `WORKER_POLL_MS` — poll interval when idle (default: 2000)
- `WORKER_LEASE_MS` — job lease duration (default: 60000)
- `WORKER_PER_USER_CONCURRENCY` — max concurrent runs per user (default: 1)

## Governance guarantees (preserved from synchronous execution)

Every guarantee from the synchronous execution model is preserved under async:

- **Deny-by-default gate** — unchanged, runs in the worker
- **Lethal-trifecta forced approval** — unchanged, runs in the worker
- **Spend caps** — checked at every loop boundary inside the worker
- **Kill mid-run** — the kill signal flips the run status; the worker's boundary check (killedReason) halts before the next step
- **Approval pause/resume + re-gate-on-resume** — unchanged; the resume path re-checks the gate
- **Memory firewall** — unchanged, runs in the worker
- **Grant revoke** — mid-run revocation detected at the kill boundary inside the worker
