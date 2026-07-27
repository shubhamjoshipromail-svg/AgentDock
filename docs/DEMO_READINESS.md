# Demo readiness — hosted checklist

Target: `https://web-production-e123b.up.railway.app`
Code under test: `main` @ `ab35ae5` (deployed 2026-07-27).

Status legend: **PASS** (verified) · **PENDING** (needs a signed-in founder session
or credentials not available to automation) · **BLOCKED** (depends on an unfinished
phase).

---

## 1. Infrastructure health — **PASS**

```
$ curl https://web-production-e123b.up.railway.app/api/health
{"ok":true,"db":{"ok":true},"worker":{"ok":true,"lastSeenAt":"2026-07-27T19:51:38Z","staleSeconds":10}}
```

`/` returns HTTP 200. Release logs on both services show `26 migrations found` and
`No pending migrations to apply`; the worker logged
`[worker] ... starting (pollMs=2000, leaseMs=60000, perUserConcurrency=1)`.

Note `worker.ok` is a FIELD, not the endpoint's status — a 200 alone does not mean
the executor is alive. Check the field.

## 2. Sign-in, guided first run, vetted flows — **PENDING**

Needs a real Google OAuth session. `DEPLOY.md` §6 lists the prerequisites
(Gmail API enabled, test users added, callback URI registered). A fresh account
should see exactly three vetted flows: `Research & email me a summary`,
`Research → you choose → email your picks`, `Brief → draft`.

## 3. Flagship multi-tool flow — **BLOCKED**

The flagship "Competitive brief" flow (search → choice → doc → calendar → email)
depends on Chunk 24 Phase 3, which is not built: Calendar, Docs, and GitHub tools
require consent-screen scopes and a GitHub PAT.

**What can be demoed today** is the existing choice flow, which already exercises
the two governance moments that matter: a mid-run human decision (choice surface)
and an approval gate showing the exact action before it executes.

## 4. Audit trail with real costs — **PENDING** (verify during item 2)

Every step appends an immutable event; per-step model cost is real and metered.

## 5. Governance holds visibly — **PASS in code, PENDING on camera**

Each of these is enforced and covered by a regression test that reproduces the
live concurrent condition, but should still be shown on the hosted URL:

| Behaviour | Enforcement | Test |
|---|---|---|
| Double-click Run → one run | partial unique index `workflow_runs_active_per_flow_unique` | `tests/one-active-run.test.ts` |
| Double-resolve an approval → resolves once, 409 | conditional update on `status = pending` | `tests/approval-resolution-idempotency.test.ts` |
| Kill mid-run | checked at every loop boundary | `tests/async-safety.test.ts` |
| Ungranted tool refused legibly | deny-by-default gate + guidance naming the remedy | `tests/gmail-send-blocker.test.ts`, `tests/run-guidance.test.ts` |

## 6. No fabricated numbers, no blank-on-error — **PASS**

Chunk 24 Phase 5 removed the invented `$5.00 weekly cap` and the hardcoded
`RUN_CAP_CENTS`; spend figures now come from the server's real enforced caps or
the surface is hidden. Grant display calls the gate's own `effectiveGrantPermission`,
so a blocked grant can no longer render as a green check, and grants are filtered
to the agent that holds them. `app/global-error.tsx` prevents a render throw from
white-screening the product. Covered by `tests/demo-surface-honesty.test.ts`.

Raw-envelope and reasoning-as-output suppression predate this chunk and are
covered by `tests/run-engine.test.ts`.

## 7. Funnel records an activation event — **PENDING**

`GET /api/admin/funnel` 404s unless the signed-in address is in `FOUNDER_EMAILS`.
Confirm that variable is set on the `web` service before testing.

---

## Verdict

**Not yet demo-ready as specified.** Items 1 and 6 pass. Items 2, 4, 5 and 7 are
ready in code and need one signed-in hosted pass. Item 3 is blocked on Phase 3
tooling.

The honest position: the *governance* story is demonstrable today — real search,
a real mid-run human decision, a real approval gate, a real audit trail, and
visible enforcement under double-fire. The *multi-tool coordination* story is not,
because only three executable tools exist (`search:web_search`,
`gmail:create_draft`, `gmail:send_email`). That is a tool-inventory gap, not a
composer gap.
