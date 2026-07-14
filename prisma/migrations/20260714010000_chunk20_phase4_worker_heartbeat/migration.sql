-- Chunk 20 Phase 4: worker liveness heartbeat (operational visibility only).
-- Each worker process upserts its row every poll loop; /api/health reads the
-- most recent last_seen_at so an operator can tell whether the run executor is
-- alive. No user data.
CREATE TABLE "worker_heartbeats" (
  "worker_id" TEXT NOT NULL,
  "pid" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);
