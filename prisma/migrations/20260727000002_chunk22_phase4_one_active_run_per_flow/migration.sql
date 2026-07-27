-- Chunk 22 Phase 4: restore "at most one active run per (user, flow)" as a
-- DATABASE CONSTRAINT, and make it un-demotable.
--
-- History this repairs: chunk20 (20260715000001) created exactly this index.
-- chunk21 (20260715000002) DROPPED it the very next migration, because the index
-- as written could not express the reviewed `allowConcurrent` escape hatch, and
-- replaced it with a 10-second wall-clock window. That window does not cover the
-- most common real case -- a run paused for approval for longer than ten seconds --
-- so two concurrent runs of one flow became creatable again.
--
-- The fix expresses the escape hatch INSIDE the predicate rather than buying it by
-- weakening the guarantee: the index covers only runs that did not deliberately
-- opt out. A feature can no longer be bought by demoting the invariant.

ALTER TABLE "workflow_runs"
  ADD COLUMN "allow_concurrent" BOOLEAN NOT NULL DEFAULT false;

-- Resolve any pre-existing active duplicates so the index can build on an existing
-- database: keep the most recent active run per (user, flow) and halt the older
-- ones. Resolve their jobs first so a worker cannot later claim a run this
-- migration just made terminal.
UPDATE "run_jobs" j
SET "status" = 'failed',
    "claimed_by" = NULL,
    "lease_expires_at" = NULL,
    "last_error" = 'Superseded by a newer active run when the one-active-run invariant was restored.'
FROM "workflow_runs" a
WHERE j."workflow_run_id" = a."id"
  AND j."status" IN ('queued', 'running', 'paused')
  AND a."allow_concurrent" = false
  AND a."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
  AND EXISTS (
    SELECT 1 FROM "workflow_runs" b
    WHERE b."user_id" = a."user_id"
      AND b."workflow_id" = a."workflow_id"
      AND b."allow_concurrent" = false
      AND b."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
      AND (b."created_at" > a."created_at"
           OR (b."created_at" = a."created_at" AND b."id" > a."id"))
  );

UPDATE "workflow_runs" a
SET "status" = 'halted_error', "ended_at" = COALESCE(a."ended_at", NOW())
WHERE a."allow_concurrent" = false
  AND a."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
  AND EXISTS (
    SELECT 1 FROM "workflow_runs" b
    WHERE b."user_id" = a."user_id"
      AND b."workflow_id" = a."workflow_id"
      AND b."allow_concurrent" = false
      AND b."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
      AND (b."created_at" > a."created_at"
           OR (b."created_at" = a."created_at" AND b."id" > a."id"))
  );

DROP INDEX IF EXISTS "workflow_runs_active_per_flow_unique";

CREATE UNIQUE INDEX "workflow_runs_active_per_flow_unique"
  ON "workflow_runs" ("user_id", "workflow_id")
  WHERE "status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
    AND "allow_concurrent" = false;
