# Chunk 21 phase 0 reconciliation

Date: 2026-07-15

This is the historical Phase 0 snapshot. The completed local invariant map and
remaining hosted founder gates are in `docs/chunk21-invariants.md`.

This pass starts from `codex/complete-interrupted-claude-task` at `a426d60`.
The repository, commits, tests, and migration state were treated as the source of
truth; the stale Desktop checkout was not used.

## Stabilization status

| Item | Landed evidence | Verification | Chunk 21 disposition |
| --- | --- | --- | --- |
| E1 duplicate run triggers | `18c0b36` | concurrent run tests and one active-run partial unique index | Preserve, then add per-click idempotency keys, the short-window API rule, and plan/save idempotency in phase 1. |
| E2 reasoning leak | `2a85c10` | deliberation rejection and genuine-prose recovery tests | Replace the remaining prose heuristic with the stricter declared-final invariant in phase 2. |
| E3 placeholder flow name | `23752e1` | schema/route validation tests | Complete; retain server-side rejection/name derivation. |
| E4 dual planner inputs | `7ff58d5` | `tests/stabilization-ui.test.ts` | Complete; retain the one-visible-input rule. |
| E5 flow archive | `af693e2` | `tests/workflow-archive.test.ts` | Complete; reuse for the vetted-flow dropdown. |
| E6 Step/Grants overlap | `30c8b11` | `tests/stabilization-ui.test.ts` | Complete; phase 4 removes remaining placeholder inspector content. |
| E7 metadata-only palette tools | `324d104` | `tests/stabilization-ui.test.ts` | Complete; executable identity is required. |
| E8 orphaned interaction intents | `b9a7215` | terminal completion/error/kill lifecycle tests | Complete; retain the transactional terminal transition. |

Draft-only behavior was aligned in `a426d60`: new users default to sending off,
send goals resolve to an approval-gated Gmail draft, and draft creation is a
reversible mailbox write that requires approval.

## Baseline and remaining work

- Baseline: 45 test files / 312 tests pass; TypeScript and production/MCP builds
  pass; 22 database migrations are current.
- Phase 1 remains necessary because the active-run index is workflow-scoped but
  there is no persisted client idempotency key, no explicit short-window API
  contract, and planning/saving can still be replayed.
- Phase 2 remains necessary because raw substantive prose is still inferred as a
  final deliverable. Chunk 21 requires an explicit `type: "final"` declaration.
- The three vetted flows, demo-path visual QA, and Railway service configuration
  are not present yet.
- Live Gmail and hosted Railway verification require a signed-in Google account,
  a running worker, Railway project access, production secrets, and founder-side
  OAuth configuration. Agent-owned code/configuration work proceeds without
  inventing or exposing those secrets.
