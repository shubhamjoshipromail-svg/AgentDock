-- Chunk 20 Phase 6: activation-funnel product analytics (append-only).
-- One row per funnel stage a user reaches. Carries ids + stage name + an optional
-- non-PII decision flag + timestamp only — never user content.
CREATE TABLE "product_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "event" TEXT NOT NULL,
  "run_id" UUID,
  "workflow_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_events_user_id_idx" ON "product_events" ("user_id");
CREATE INDEX "product_events_event_idx" ON "product_events" ("event");
CREATE INDEX "product_events_run_id_idx" ON "product_events" ("run_id");
CREATE INDEX "product_events_created_at_idx" ON "product_events" ("created_at");

ALTER TABLE "product_events"
  ADD CONSTRAINT "product_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
