# Chunk 24 Phase 0 — Verified consolidation into `main`

The instruction was to consolidate the *correct* code, not to merge everything reflexively.
This is the audit that preceded the merge, and the verification that followed it.

**Result:** `main` is now `c0c4cef` — a true fast-forward, no merge commit, nothing
cherry-picked, nothing discarded, because **there was nothing unique to discard**.

---

## 1. The headline finding

`codex/complete-interrupted-claude-task` is a **strict ancestor** of
`codex/chunk21-final-pass`. Not "equivalent patches" — literally the same commit SHAs,
reachable from the newer branch.

```
git merge-base --is-ancestor \
  origin/codex/complete-interrupted-claude-task \
  origin/codex/chunk21-final-pass          → true

git cherry -v origin/codex/chunk21-final-pass \
            origin/codex/complete-interrupted-claude-task   → (empty)
```

Both branches reported "+N ahead / 0 behind `main`" because both genuinely were ahead of
`main` — but the 7 are a **subset** of the 28, not a parallel line of work. The apparent
fragmentation was one line of work observed at two points.

This is why the audit mattered: a reflexive `git merge` of both branches would have
produced the same tree but an unnecessary merge commit and a misleading history implying
two streams were reconciled.

---

## 2. Commit classification

All 7 commits on `codex/complete-interrupted-claude-task`, checked individually with
`git merge-base --is-ancestor <sha> origin/codex/chunk21-final-pass`:

| Commit | Subject | Contained in chunk21? | Unique value | Decision | Reason |
|---|---|---|---|---|---|
| `18c0b36` | fix(E1): make run creation single-path and idempotent | Yes | none | **Keep (via ancestry)** | Same SHA already in the merged line. Superseded in behaviour by `5c98819` (Chunk 22 Phase 4), which restored the DB constraint this commit's successor had demoted to a 10s window. |
| `7ff58d5` | fix(E4): expose one shared planner surface | Yes | none | **Keep (via ancestry)** | Same SHA. |
| `af693e2` | fix(E5): add soft-archive lifecycle for flows | Yes | none | **Keep (via ancestry)** | Same SHA. Brings `app/api/workflows/[workflowId]/archive/route.ts` + `tests/workflow-archive.test.ts`. |
| `30c8b11` | fix(E6): merge participant details and grants | Yes | none | **Keep (via ancestry)** | Same SHA. |
| `324d104` | fix(E7): hide non-executable palette tools | Yes | none | **Keep (via ancestry)** | Same SHA. |
| `b9a7215` | fix(E8): expire intents on every terminal run path | Yes | none | **Keep (via ancestry)** | Same SHA. Underpins `transitionRunToTerminal`. |
| `a426d60` | fix(draft): align draft-only planning and approval | Yes | none | **Keep (via ancestry)** | Same SHA. |

**Discarded: none.** No commit was unique, so no commit needed judging on merit. Had any
been unique it would have been assessed against the Chunk 22 guarantees before inclusion.

The reverse diff confirms the direction of containment: `chunk21-final-pass` carries **89
files / +6,583 / -624** beyond the older branch (Chunk 21 completion plus all of Chunk 22).

---

## 3. Migration coherence

26 migrations in the merged set. Verified:

- **No duplicate directory names.**
- **Monotonic ordering** — timestamps strictly increase; no interleaving from a parallel
  branch, which follows from the linear ancestry.
- **One object is mutated by three migrations, deliberately and in sequence** — worth
  recording because it is exactly the "incompatible mutation" case worth checking:

  | Migration | Effect on `workflow_runs_active_per_flow_unique` |
  |---|---|
  | `20260715000001_chunk20_e1_one_active_run_per_flow` | CREATE |
  | `20260715000002_chunk21_idempotency` | DROP (traded for a 10-second window) |
  | `20260727000002_chunk22_phase4_one_active_run_per_flow` | `DROP IF EXISTS` then CREATE with `AND allow_concurrent = false` |

  Each step is idempotent (`DROP INDEX IF EXISTS`) and each later step supersedes the
  earlier, so the sequence converges on the Chunk 22 predicate from any starting point.
  Not a conflict.

- **Fresh-database apply verified** — `prisma migrate deploy` against a brand-new database
  (not incremental): *All migrations have been successfully applied.*

---

## 4. Verification of merged `main`

| Gate | Result |
|---|---|
| Full suite | **54 files / 386 tests green** |
| Typecheck (`tsc --noEmit`) | clean |
| Fresh-DB `migrate deploy` | clean |
| Chunk 22 guarantee tests (5 files) | **33 tests green** |

The four Chunk 22 database objects were confirmed present on the freshly-migrated database,
not merely in the schema file:

```
index: approval_requests_active_action_unique
index: workflow_runs_active_per_flow_unique
col:   allow_concurrent
col:   env_allowlist
```

Guarantees specifically re-verified on `main`: MCP env isolation, approval compare-and-set,
mandate scope/amount enforcement, queue-only resume, one-active-run index.

---

## 5. Branch hygiene

Both feature branches are fully contained in `main`, so deleting them loses nothing. They
were tagged before deletion anyway, so the exact tips remain addressable:

- `archive/chunk21-final-pass` → `c0c4cef`
- `archive/complete-interrupted-claude-task` → `a426d60`

`main` is canonical from here. All future work branches from `main` and merges back
promptly.

---

## 6. What this does NOT yet change

The live Railway deployment. `main` now contains the Chunk 21/22 security work, but the
hosted site only picks it up when the deploy is pointed at this commit and redeployed
(Phase 2). Until then the live site is still serving pre-Chunk-22 code and lacks MCP env
isolation, single-shot approval resolution, mandate enforcement, and the one-active-run
invariant.
