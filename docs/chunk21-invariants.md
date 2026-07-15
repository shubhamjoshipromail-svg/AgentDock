# Chunk 21 release invariants

Date: 2026-07-15

This file is the final code-to-test map for the pre-MVP stabilization pass. It
documents guarantees the repository enforces locally. Founder-owned hosted
verification is deliberately listed separately and is not inferred from mocked
tests.

## 1. One user action creates one run or flow

The UI creates one idempotency key per explicit click and routes the only Run
affordance through `components/workspace/FlowWorkspace.tsx`. The legacy Control
Plane trigger is absent. The workspace and Build drawer also share one planner
state, so two visible describe inputs cannot race.

The server does not trust the UI alone:

- `WorkflowRun` has a unique `(userId, idempotencyKey)` constraint in
  `prisma/schema.prisma`, installed by
  `prisma/migrations/20260715000002_chunk21_idempotency/migration.sql`.
- `app/api/runs/route.ts` rejects a same-user, same-workflow queued/running/paused
  creation inside the short concurrency window unless the API caller explicitly
  sets `allowConcurrent`. The product UI never sets it.
- `lib/idempotency.ts` gives plan and flow-save requests one durable response per
  user/scope/key, with payload-hash conflict detection and a Postgres advisory
  lock around first execution.
- Resume reuses the existing run and approval action. It does not call run
  creation.

Regression evidence:

- `tests/run-engine.test.ts`: persisted-key replay, concurrent API retries,
  short-window rejection, explicit concurrent escape hatch, and active-run races.
- `tests/orchestrator.route.test.ts`: sequential and concurrent plan replay.
- `tests/api.integrity.test.ts`: concurrent identical save and conflicting replay.
- `tests/stabilization-ui.test.ts`: one Run owner and one visible planner input.
- `tests/approval-integrity.test.ts`, `tests/interaction-intent.test.ts`, and
  `tests/crash-recovery.test.ts`: approval/intent resume and re-drive behavior.

## 2. Only a declared final is a deliverable

`lib/execution/run-engine.ts` recognizes a deliverable only from an explicit
`{"type":"final","text":"..."}` envelope. Raw prose, including substantive
prose and deliberation-shaped text, is never promoted. A missing required input
must produce a validated interaction intent or an honest non-completion.

An invalid envelope gets one policy-correction attempt. A second invalid response
halts the run without a deliverable. Recovery is narrow: it may repair content
inside an identifiable declared-final channel, but it never scavenges free prose.
Tool errors remain errors and cannot be narrated into success.

Regression evidence:

- `tests/run-engine.test.ts`: raw deliberation, raw substantive prose, one valid
  correction, malformed long Markdown final, and tool-error honesty.
- `tests/interaction-intent.test.ts`: missing-topic form pause/answer/resume,
  choice/form schema enforcement, untrusted answers, and approval separation.
- `tests/vetted-flows-run.test.ts`: clean declared finals after the real engine's
  mocked Search/Gmail/approval paths.

## 3. Every account gets the three governed MVP flows

`lib/catalog/vetted-flows.js` is the single installer used by
`app/api/bootstrap/route.ts`, `prisma/seed.js`, and
`scripts/backfill-vetted-flows.js`. It serializes concurrent installs with a
Postgres advisory lock, preserves custom and archived flows, and ensures exactly
these managed flows for a fresh account:

1. `Research & email me a summary`
2. `Research → you choose → email your picks`
3. `Brief → draft`

Only canonical executable Search and Gmail tools are pre-wired. Draft-only is the
default. `send_email` appears only after explicit sending opt-in and always keeps
`requiresApproval`.

Regression evidence:

- `tests/vetted-flows.test.ts`: fresh bootstrap, backfill/idempotency, concurrent
  bootstrap, preservation, executable-only grants, and send opt-in posture.
- `tests/vetted-flows-run.test.ts`: all three flows through the real route/engine
  with mocked model/MCP boundaries, interaction surfaces, approval stops, clean
  finals, and funnel events.
- `tests/workflow-archive.test.ts`: archived flows leave the active dropdown.

These tests prove the product contracts without sending network email. Real
Search/Gmail and hosted OAuth remain founder smoke gates.

## 4. The demo surface has bounded, truthful UI

`components/workspace/FlowWorkspace.tsx` and
`components/workspace/workspace.css` give Build, Connect, and Activity one active
tab, a bounded drawer height, and internal vertical scrolling. Build and Activity
share consistent padding. `components/build/Builder.tsx` renders the goal anchor
as a meaningful empty state, not a fake participant with invented risk/cost/grant
metadata. Metadata-only tools remain excluded from the executable palette.

Regression evidence:

- `tests/stabilization-ui.test.ts`: drawer bounds/scroll contract, one active tab,
  one planner input, merged participant/grant inspector, executable-only palette,
  and truthful goal empty state.
- Authenticated local browser verification at 1,470×727 confirmed one active tab,
  a 375px drawer, a 337px internal panel, and 1,798px Activity content scrolling
  inside that panel. The browser console had no errors.

Founder visual approval is still a human gate; local screenshots are evidence for
that review, not a substitute for it.

## 5. Railway deploys the same image as two supervised processes

`railway.web.json` and `railway.worker.json` both build the root `Dockerfile` and
run `npx prisma migrate deploy` before release. Their start commands are distinct:
`npm run start` and `npm run worker`. The web service checks `/api/health`; the
worker has no public health route and uses Railway's always-restart policy.

The Dockerfile generates Prisma, compiles both first-party MCP servers, and builds
Next.js. `tsx` and `dotenv` are production dependencies because the standalone
worker needs them at runtime. `.env.example` names every required secret and cap,
and `docs/DEPLOY.md` is the founder click-path and hosted smoke checklist.

Regression evidence:

- `tests/deployment-config.test.ts`: both service configs, image build contract,
  runtime dependencies, auth aliases, environment template, and deploy guide.
- Local clean-install image-step validation: `npm ci`, `prisma generate`, both MCP
  builds, and the production Next build.
- Local production server validation on a non-default `PORT` with
  `/api/health` returning HTTP 200 and `db.ok: true`.

Docker itself is unavailable on the verification machine, but Railway built both
Docker images successfully from the pushed branch. Railway `web`, `worker`, and
Postgres are live in EU West; all 23 migrations applied, `/` returned HTTP 200,
and `/api/health` returned both `db.ok: true` and `worker.ok: true`. Google OAuth,
OAuth test users, a planner key, and the hosted Gmail flow still require founder
credentials/configuration.

## Final hosted release gate

Infrastructure item 1 passed on 2026-07-15 at
`https://web-production-e123b.up.railway.app`. The chunk is externally complete
only after the founder follows `docs/DEPLOY.md` and records the remaining checks
on that hosted URL:

1. `db.ok` and `worker.ok` are both true.
2. A fresh OAuth test account sees exactly the three vetted flows.
3. The choice flow performs real Search, pauses for the choice, pauses again for
   the exact Gmail action, lands a draft/approved send, and shows a clean result.
4. Run-button spam creates one run, and a missing topic produces a form rather
   than leaked reasoning.
5. `/api/admin/funnel` ends in activation for the smoke session.
