# Chunk 22 — Phase 0: ground truth

Baseline established before any Chunk-22 change. Everything below was verified in this
working tree, not carried over from a prior summary.

## Branch

- Branch: `codex/chunk21-final-pass` @ `fdf9b1f`
- 21 commits ahead of `main`; **not** merged, and this chunk does not merge it.

## Green baseline

`npm test` → **49 files, 353 tests, 0 failures** (~50s), against the local test database.

## Test database (changed this session)

The previously used local Postgres lived in a sibling checkout (`~/Desktop/Agent platform/.pgbin`
+ `.pgdata`). That directory became unreadable — files report correct sizes but read as zero
bytes, including `.pgdata/PG_VERSION` and the bundled timezone data, which is why the server
refused to start (`invalid value for parameter "log_timezone"`).

The test DB is now the repo's own compose service:

```
docker compose up -d postgres      # pgvector/pgvector:pg16, per docker-compose.yml
```

Credentials already match `.env.test` (`agentdock:agentdock@localhost:5432`), so no config
change was needed; `agentdock_test` was created inside the container. **No file in the repo was
modified for this.**

Two environment notes, neither addressed here (out of scope, and both are local-only):

- `.env` line 11 contains a pasted shell command
  (`cd "/Users/shubhamjoshi/Desktop/Agent platform" && npx prisma db seed`), which makes
  `docker compose` fail to parse the file. Worked around with `--env-file` pointing at an empty
  file. The line should be removed by hand — it is not a repo file.
- The sibling checkout's unreadable state is worth investigating independently; it also held a
  database.

## The idempotency helper (Phase 2 will use this)

The review cited `lib/idempotency.ts`; that is correct and the module exists. Exact API:

```ts
// lib/idempotency.ts:14
export function readIdempotencyKey(request: Request):
  | { ok: true; key: string }
  | { ok: false; response: NextResponse }

// lib/idempotency.ts:30
export async function runIdempotently(options: {
  request: Request;
  userId: string;
  scope: "flow_plan" | "flow_save";   // ← closed union; Phase 2 must widen it
  input: unknown;
  work: () => Promise<NextResponse>;
}): Promise<NextResponse>
```

Backed by the `IdempotencyRecord` model with `@@unique([userId, scope, key])` (migration
`20260715000002_chunk21_idempotency`). Key format is enforced by
`IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/`.

**Consequence for Phase 2:** `scope` is a closed string union, so adding approval resolution
requires widening that type (e.g. `| "approval_resolve"`). No new module is needed.

## Target sites — corrected line numbers

The chunk brief cited some line numbers that do not match this tree. Verified positions:

| Target | Brief said | **Actual** |
|---|---|---|
| MCP child env spread | `mcp-client.ts:125` | **`mcp-client.ts:125`** — correct |
| Broker call with dead amount | `run-engine.ts:964` | **`run-engine.ts:1209`** (`amountCents: costCents`), with `let costCents = 0` at **`:1107`** |

Other sites this chunk touches:

| Concern | Location |
|---|---|
| Broker limit check | `credential-broker.ts:88` |
| Broker scope check (null-scope hole) | `credential-broker.ts:91` |
| Approval read (no status predicate) | `resolve/route.ts:29` |
| Intent resolve write (no status guard) | `resolve/route.ts:52` |
| Approval resolve write (no status guard) | `resolve/route.ts:84-87` |
| Re-enqueue on resolve (resets claimed jobs) | `resolve/route.ts:57`, `:205` |

## Phase 3 scope — measured

The direct-resume call sites the review flagged, counted in this tree:

- Production: `lib/execution/run-engine.ts` (4 refs), `lib/execution/run-queue.ts` (4 refs)
- Tests (12 files): `approval-integrity` (3), `crash-recovery` (5), `gmail-generic` (2),
  `grant-tools` (2), `interaction-intent` (12), `mcp-execution` (10), `mcp-red-team` (2),
  `red-team` (3), `run-engine` (6), `vetted-flows-run` (5)

So Phase 3 is predominantly a test migration, as the brief anticipated.

## Binding meta-rule for this chunk

Every guarantee established here must be (a) enforced at the lowest available layer
(DB constraint > server check > client guard), and (b) covered by a regression test that
reproduces the **live concurrent** condition through the production path. A test that exercises
a direct-call shortcut does not count as coverage.
