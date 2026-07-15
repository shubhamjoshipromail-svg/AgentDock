-- Chunk 21 phase 1: durable per-click idempotency plus an explicit, short
-- workflow concurrency window. The prior partial unique index enforced one
-- active run forever and therefore could not support the reviewed
-- `allowConcurrent` escape hatch. A transaction-scoped advisory lock now makes
-- the 10-second rule atomic; this migration keeps the stronger invariant that a
-- given client key can never create two runs.

ALTER TABLE "workflow_runs" ADD COLUMN "idempotency_key" TEXT;

DROP INDEX IF EXISTS "workflow_runs_active_per_flow_unique";

CREATE UNIQUE INDEX "workflow_runs_user_id_idempotency_key_key"
  ON "workflow_runs" ("user_id", "idempotency_key");

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "response" JSONB,
  "http_status" INTEGER,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_user_id_scope_key_key"
  ON "idempotency_records" ("user_id", "scope", "key");

CREATE INDEX "idempotency_records_user_id_created_at_idx"
  ON "idempotency_records" ("user_id", "created_at");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
