-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowRunStatus" ADD VALUE 'queued';
ALTER TYPE "WorkflowRunStatus" ADD VALUE 'paused_for_approval';
ALTER TYPE "WorkflowRunStatus" ADD VALUE 'halted_cost';
ALTER TYPE "WorkflowRunStatus" ADD VALUE 'halted_error';
ALTER TYPE "WorkflowRunStatus" ADD VALUE 'killed';

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "model" TEXT,
ADD COLUMN     "system_prompt" TEXT;

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "limit_cents" INTEGER,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "step_index" INTEGER;

-- AlterTable
ALTER TABLE "mcp_access_grants" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "limit_cents" INTEGER,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "signature" TEXT;

-- AlterTable
ALTER TABLE "scoped_credentials" ADD COLUMN     "encrypted_key" TEXT,
ADD COLUMN     "encryption_auth_tag" TEXT,
ADD COLUMN     "encryption_iv" TEXT,
ADD COLUMN     "last4" TEXT;

-- AlterTable
ALTER TABLE "workflow_run_events" ADD COLUMN     "actor_id" TEXT,
ADD COLUMN     "actor_type" TEXT,
ADD COLUMN     "authority_ref" TEXT,
ADD COLUMN     "resource_id" TEXT,
ADD COLUMN     "resource_type" TEXT,
ADD COLUMN     "schema_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "untrusted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "kill_reason" TEXT,
ADD COLUMN     "killed_at" TIMESTAMP(3),
ADD COLUMN     "step_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tool_call_count" INTEGER NOT NULL DEFAULT 0;
