-- Chunk 11: durable run queue.
-- Postgres-backed queue chosen to avoid adding Redis/external broker while the
-- product is still single-region/single-database. Workers claim rows with
-- SELECT ... FOR UPDATE SKIP LOCKED and short leases.

CREATE TYPE "RunJobStatus" AS ENUM (
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'killed'
);

CREATE TABLE "run_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "workflow_run_id" UUID NOT NULL,
  "status" "RunJobStatus" NOT NULL DEFAULT 'queued',
  "claimed_by" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "step_cursor" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "run_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_jobs_workflow_run_id_key" ON "run_jobs"("workflow_run_id");
CREATE INDEX "run_jobs_status_lease_expires_at_created_at_idx" ON "run_jobs"("status", "lease_expires_at", "created_at");
CREATE INDEX "run_jobs_user_id_status_idx" ON "run_jobs"("user_id", "status");

ALTER TABLE "run_jobs"
  ADD CONSTRAINT "run_jobs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_jobs"
  ADD CONSTRAINT "run_jobs_workflow_run_id_fkey"
  FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
