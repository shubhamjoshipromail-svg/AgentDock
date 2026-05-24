-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('pending', 'running', 'waiting_for_approval', 'completed', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "WorkflowRunEventType" AS ENUM ('orchestration', 'a2a_handoff', 'mcp_tool_use', 'memory_access', 'credential_minted', 'approval_requested', 'action_blocked', 'spend_event', 'workflow_completed');

-- CreateEnum
CREATE TYPE "RuntimeDecision" AS ENUM ('allowed', 'blocked', 'approval_required', 'approved', 'denied', 'info');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('pending', 'approved', 'denied', 'edited', 'expired');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('resume_draft_review', 'gmail_draft_approval', 'memory_access_request', 'application_submission', 'email_send', 'payment', 'tool_scope_change');

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "total_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "risk_level" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_run_events" (
    "id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_id" UUID,
    "event_type" "WorkflowRunEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision" "RuntimeDecision",
    "mcp_tool" TEXT,
    "memory_partition_id" UUID,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "agent_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "action_type" "ApprovalActionType" NOT NULL,
    "risk_level" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID,
    "workflow_run_id" UUID,
    "agent_id" UUID,
    "event_type" "WorkflowRunEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision" "RuntimeDecision",
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_runs_user_id_created_at_idx" ON "workflow_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_id_created_at_idx" ON "workflow_runs"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_run_events_workflow_run_id_created_at_idx" ON "workflow_run_events"("workflow_run_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_run_events_user_id_created_at_idx" ON "workflow_run_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_run_events_agent_id_idx" ON "workflow_run_events"("agent_id");

-- CreateIndex
CREATE INDEX "workflow_run_events_memory_partition_id_idx" ON "workflow_run_events"("memory_partition_id");

-- CreateIndex
CREATE INDEX "approval_requests_user_id_status_requested_at_idx" ON "approval_requests"("user_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "approval_requests_workflow_run_id_idx" ON "approval_requests"("workflow_run_id");

-- CreateIndex
CREATE INDEX "approval_requests_agent_id_idx" ON "approval_requests"("agent_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "activity_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_workflow_id_idx" ON "activity_logs"("workflow_id");

-- CreateIndex
CREATE INDEX "activity_logs_workflow_run_id_idx" ON "activity_logs"("workflow_run_id");

-- CreateIndex
CREATE INDEX "activity_logs_agent_id_idx" ON "activity_logs"("agent_id");

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_memory_partition_id_fkey" FOREIGN KEY ("memory_partition_id") REFERENCES "memory_partitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
