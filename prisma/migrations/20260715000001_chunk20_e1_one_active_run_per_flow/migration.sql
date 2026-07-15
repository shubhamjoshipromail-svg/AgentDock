-- Chunk 20 / E1: at most ONE active run per (user, flow).
-- A double-fired run trigger (two UI surfaces, or a double-click) created two
-- runs seconds apart. Enforce the invariant at the DB level (mirrors the Chunk 18
-- approval-uniqueness index): a partial unique index over the non-terminal run
-- statuses. First resolve any pre-existing active duplicates (keep the most recent
-- active run per (user, flow), halt the older ones) so the index can be built on
-- an existing database. Resolve the matching jobs first so a worker cannot later
-- claim a run this migration just made terminal.

UPDATE "run_jobs" j
SET "status" = 'failed',
    "claimed_by" = NULL,
    "lease_expires_at" = NULL,
    "last_error" = 'Superseded by a newer active run during duplicate-run cleanup.'
FROM "workflow_runs" a
WHERE j."workflow_run_id" = a."id"
  AND j."status" IN ('queued', 'running', 'paused')
  AND a."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
  AND EXISTS (
    SELECT 1 FROM "workflow_runs" b
    WHERE b."user_id" = a."user_id"
      AND b."workflow_id" = a."workflow_id"
      AND b."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
      AND (b."created_at" > a."created_at"
           OR (b."created_at" = a."created_at" AND b."id" > a."id"))
  );

UPDATE "workflow_runs" a
SET "status" = 'halted_error', "ended_at" = COALESCE(a."ended_at", NOW())
WHERE a."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
  AND EXISTS (
    SELECT 1 FROM "workflow_runs" b
    WHERE b."user_id" = a."user_id"
      AND b."workflow_id" = a."workflow_id"
      AND b."status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval')
      AND (b."created_at" > a."created_at"
           OR (b."created_at" = a."created_at" AND b."id" > a."id"))
  );

CREATE UNIQUE INDEX "workflow_runs_active_per_flow_unique"
  ON "workflow_runs" ("user_id", "workflow_id")
  WHERE "status" IN ('queued', 'running', 'pending', 'waiting_for_approval', 'paused_for_approval');
