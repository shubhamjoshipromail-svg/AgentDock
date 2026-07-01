-- Chunk 18 Phase 3: the unified interaction primitive.
-- The approval_requests table becomes the one InteractionIntent table: approval
-- is one intent type, choice/form/confirmation are the others. Additive — existing
-- rows read back as intent_type = 'approval'.

ALTER TABLE "approval_requests"
  ADD COLUMN "intent_type" TEXT NOT NULL DEFAULT 'approval',
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "response" JSONB;

-- A human-answered non-approval intent.
ALTER TYPE "ApprovalRequestStatus" ADD VALUE IF NOT EXISTS 'responded';
