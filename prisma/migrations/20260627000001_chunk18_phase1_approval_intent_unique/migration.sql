-- Chunk 18 Phase 1: one active approval intent per (run, step, action).
-- The "double requests" bug let a re-reached gate create a second approval card
-- for an action already awaiting/holding authorization. This makes that
-- impossible at the DB level: only ONE approval per
-- (workflow_run_id, step_index, scope) may be simultaneously active
-- (pending / approved / edited). Denied/expired rows are unconstrained, and rows
-- without a step or scope (legacy / non-tool approvals) are exempt (NULLs).
--
-- First expire the historical duplicates the old bug already created (keep the
-- most recent active intent per action, expire the rest) so the unique index can
-- be built on any existing database. Idempotent (DROP IF EXISTS) so it can be
-- safely re-applied.

UPDATE "approval_requests" a
SET "status" = 'expired'
WHERE a."status" IN ('pending', 'approved', 'edited')
  AND a."step_index" IS NOT NULL
  AND a."scope" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "approval_requests" b
    WHERE b."workflow_run_id" = a."workflow_run_id"
      AND b."step_index" = a."step_index"
      AND b."scope" = a."scope"
      AND b."status" IN ('pending', 'approved', 'edited')
      AND (b."requested_at" > a."requested_at"
           OR (b."requested_at" = a."requested_at" AND b."id" > a."id"))
  );

DROP INDEX IF EXISTS "approval_requests_active_action_unique";

CREATE UNIQUE INDEX "approval_requests_active_action_unique"
  ON "approval_requests" ("workflow_run_id", "step_index", "scope")
  WHERE "status" IN ('pending', 'approved', 'edited')
    AND "step_index" IS NOT NULL
    AND "scope" IS NOT NULL;
