# Chunk 22 — Trust foundation: what closed, what proves it, what remains

Implements the BLOCKER findings from [`FULL_REVIEW.md`](./FULL_REVIEW.md).
Branch `codex/chunk21-final-pass` (**not merged to `main`** — that is a separate,
deliberate step once verified live).

**Final gate:** `npm test` → **54 files / 386 tests green**; `npx tsc --noEmit` clean;
`prisma migrate deploy` verified against a **fresh** database (not just incrementally),
with both new database objects confirmed present. Baseline at the start of the chunk
was 49 files / 353 tests.

---

## The binding rule this chunk was written under

> Invariants in this codebase have repeatedly decayed into heuristics under feature
> pressure. Every guarantee must be (a) enforced at the lowest possible layer
> (DB constraint > server check > client guard), and (b) protected by a regression
> test that reproduces the LIVE concurrent condition. A fix whose test exercises a
> non-production code path does not count.

Each entry below names the layer the guarantee actually lives at.

---

## Finding to fix to proof

### BLOCKER 1 — MCP children inherited the entire host environment

- **Was:** `env: { ...process.env, ...ctx.env }` (`mcp-client.ts:125`) handed every tool
  process `CREDENTIAL_ENCRYPTION_KEY` **and** `DATABASE_URL` — together enough to decrypt
  every user's OAuth tokens and BYO keys. Verified against a real spawned child: **92+
  host variables**.
- **Now:** a server receives only the SDK's minimal safe base (`PATH`, `HOME`, `LOGNAME`,
  `SHELL`, `TERM`, `USER`), the keys its `ServerRegistration.env_allowlist` declares, and
  its brokered token. Gmail declares `[]` (its token arrives via the broker); search
  declares only `RUN_TOOL_COST_CENTS`.
- **Layer:** database column, deny-by-default (`DEFAULT ARRAY[]::TEXT[]`), applied at one
  chokepoint (`buildChildEnv`).
- **Commit:** `6993472`
- **Proof:** `tests/mcp-env-isolation.test.ts` — spawns a **real child process** and asks
  it which variables it actually received. A revert to spreading `process.env` goes red.

### BLOCKER 2 — approval resolution was replayable

- **Was:** the route read the approval and wrote it with no status predicate. A **denied**
  approval could be replayed into **approved** with HTTP 200 — forging the consent record
  and writing an audit row saying the user approved — and a second resolve reset a job a
  worker had already claimed to `queued`/`claimedBy: null`, making the same run claimable
  by a second worker.
- **Now:** every resolution is a conditional update predicated on `status = pending`, so
  the database decides who wins. The claim and its `ActivityLog` row share one transaction,
  so a losing resolve writes nothing and returns **409** — no duplicate audit row, no
  double-counted funnel event. The choice/form/confirmation branch had the identical hole
  and got the identical guard. An optional `Idempotency-Key` routes through the existing
  `runIdempotently` helper so a genuine retry replays instead of colliding.
  `enqueueRunJob` no longer disturbs a live claim.
- **Layer:** conditional DB update (compare-and-set), not application read-then-write.
- **Commit:** `86be90b`
- **Proof:** `tests/approval-resolution-idempotency.test.ts` — replay, two concurrent
  resolves racing, denied-cannot-be-flipped, claimed-job-untouched,
  intent-cannot-be-re-answered, same-key replay. All drive the real route.

### BLOCKER 3 — the mandate spend limit never evaluated

- **Was:** `amountCents: costCents` where `costCents` was still `0` at that point, so the
  check was `0 > limit` for every action — a mandate with a spend limit refused nothing.
  Separately, the scope comparison short-circuited on `&& m.scope`, so a scopeless grant
  satisfied any action — and no code path had ever set scope, so that was every grant.
- **Now:** the engine computes the amount being authorized — the monetary value the action
  declares (`amountCents`/`totalCents`/`priceCents`, explicit cents only, never a guessed
  unit from a bare `amount`), falling back to the configured cost of the call. Scope is
  deny-by-default: a scopeless or blank grant authorizes nothing scoped. Required authority
  is named by canonical tool identity (`serverKey:toolName`); all three grant-writing paths
  set it, and existing rows are backfilled so live grants keep working instead of failing
  closed on deploy.
- **Layer:** server-side check with the value fixed at the caller; grant scope backfilled
  in a migration so the data supports it.
- **Commit:** `cde06b0`
- **Proof:** `tests/mandate-enforcement.test.ts` — null, blank, and mismatched scopes are
  refused while a matching scope is authorized; and end-to-end through the engine, an
  action exceeding the mandate is refused with `callMcpTool` never reached, while one
  within it executes.

### Structural root — the queue was barely exercised

- **Was:** ~40 call sites (nearly all tests) drove the engine directly via
  `resumeAfterApproval` / `executeExistingRun`, so the race-proof queued path — where
  production races actually live — was certified by nothing, while the tests certified a
  path production never takes. This is why the duplication family kept returning.
- **Now:** `executeExistingRun` and `resumeRunFromLatestApproval` require an
  `ExecutionLease` and verify against the database that the caller holds a **live** claim
  (matching id, `claimedBy`, status `running`, unexpired lease). A caller without one
  throws. `resumeAfterApproval` is no longer exported at all.
- **Layer:** runtime invariant checked against DB state, plus a compile-time boundary
  (the un-exported function).
- **Commit:** `32856f1`
- **Proof:** `tests/queue-only-resume.test.ts` — direct call, expired lease, and
  wrong-worker lease all throw; a real claim's lease is accepted; **two workers racing one
  queued run yield exactly one claim, one model call, one completion event**; and a source
  guard fails if any module outside the queue reaches those entry points or if
  `resumeAfterApproval` is exported again. All 10 previously-bypassing test files were
  migrated to `tests/helpers/queue.ts` and still pass — so what they assert is now asserted
  against the real seam.

### Regression repaired — one active run per flow

- **Was:** chunk20 created the partial unique index; chunk21 **dropped it in the very next
  migration** because it could not express the reviewed `allowConcurrent` escape hatch, and
  substituted a 10-second wall-clock window. That window misses the most common real case —
  a run paused for approval longer than ten seconds — so two concurrent runs of one flow
  became creatable again.
- **Now:** the index is restored with the escape hatch expressed **inside its predicate**
  rather than bought by weakening it:
  `WHERE status IN (...non-terminal...) AND allow_concurrent = false`. `createQueuedRun`
  drops the time window entirely; the application checks only avoid provoking the
  constraint, and `P2002` resolves to the existing run.
- **Layer:** database partial unique index.
- **Commit:** `5c98819`
- **Proof:** `tests/one-active-run.test.ts` — a run paused well beyond the old window still
  blocks a second; **a raw `INSERT` bypassing all application logic is rejected by the
  database**; the index is asserted to exist, so a future migration that drops it fails
  loudly; concurrent creates yield one active run; `allowConcurrent` still works.

---

## Why these five were the right first build

Money requires a gate you can trust with money. Token isolation is the floor for any
third-party (including payment) tool; single-shot resolution stops a payment approval from
ever double-firing; queue-only resume and the one-active-run constraint stop concurrent
double-execution; and the mandate fix is literally the spend-authorization primitive Stripe
will call. That primitive is now enforced against a real amount and a real scope rather
than against a constant.

---

## What only the founder can verify (live, on this branch)

1. **Both real tools still work after env isolation** — Gmail draft and send, and search.
   Automated coverage spawns a real child process, but not the real Google API.
2. **Double-click / double-resolve an approval** — it resolves once; no duplicate run, no
   double send.
3. **Fire the same flow twice quickly** — exactly one active run.
4. **A small mandate blocks a larger action** once a real amount flows through a payment-
   shaped tool.

---

## Deliberately NOT done in this chunk

- **Not merged to `main`.** The branch remains 27 commits ahead, unmerged, by instruction.
- **No client change.** The UI still sends no `Idempotency-Key` on resolve; it does not need
  to, because the status precondition is the guarantee and the key is only an ergonomic
  retry path. The missing in-flight guard on `IntentSurface` buttons is a PRE-USERS item
  below, not a security hole now that the server is single-shot.
- **No sandboxing beyond the env floor.** Process, filesystem, network, and resource
  isolation are still required before any third-party server runs.

---

## Still open from the review

**PRE-USERS** (before users beyond the founder)

- Unescaped `<untrusted>` fence — injected content can close it (`SEC-7`).
- External-send idempotency guard inspects only the most recent event, so a crash after a
  send plus one later tool call can re-send (`SEC-8`).
- SSE replays events sharing the cursor's millisecond, and is itself a 1s per-connection DB
  poller; three redundant client pollers remain (`R9`).
- `sync-registry` is open to any signed-in user and rewrites the global catalog (`SEC-5`).
- Fabricated UI numbers still render: `$5.00 weekly cap` and `RUN_CAP_CENTS = 50`, plus a
  hardcoded personal identity fallback and a mock-memory fallback on fetch failure (`R10`).
- Per-agent grants are structurally unrepresentable in the client, so revoke is flow-wide
  and a blocked grant renders as a green check (`R10`).
- No error boundary anywhere; 13 surfaces where failure is indistinguishable from emptiness.
- 2 critical / 6 high dependency CVEs; the NextAuth v4 + `@auth/prisma-adapter` v2 mismatch
  is their root. `npm run lint` is dead under Next 16.
- No rate limiting on any route.

**PRE-MONEY**

- Hash the approved action into `ApprovalRequest` and re-verify at execution, so consent is
  bound to the exact arguments.
- Sign `(mandate, action_hash, decision, timestamp)` and verify at the broker. `signature`
  is still a nullable column nothing writes.
- Encryption-key versioning; rotation currently invalidates all stored credentials.

**PRE-THIRD-PARTY**

- Real MCP isolation: separate uid, read-only filesystem, **egress allow-list**, resource
  caps. The env allowlist landed here is the floor, not the sandbox.
- Give `McpServer` a `userId` for discovered rows; the discovery reconcile still
  `deleteMany`s across tenants behind a cascade (`SEC-6`).
- Taint is still tracked by string-matching rendered prompt text, which also leaves the
  lethal-trifecta guard unreachable in practice (`SEC-10`).

---

## Environment note

The test database moved to the repo's own compose service (`docker compose up -d postgres`,
pgvector/pg16). Credentials already match `.env.test`, so no repo file changed for it. The
sibling checkout that previously hosted Postgres (`~/Desktop/Agent platform`) became
unreadable mid-session — files report correct sizes but read as zero bytes — and is worth
investigating independently, since it also held a database. Separately, `.env` line 11
contains a pasted shell command that makes `docker compose` fail to parse the file; it was
worked around, not edited, since `.env` is not a repo file.
