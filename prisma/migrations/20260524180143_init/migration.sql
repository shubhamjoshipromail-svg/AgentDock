-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('manual', 'approval_gated', 'autonomous_with_limits');

-- CreateEnum
CREATE TYPE "MemoryPartitionType" AS ENUM ('global', 'workflow', 'domain', 'team');

-- CreateEnum
CREATE TYPE "SensitivityLevel" AS ENUM ('low', 'medium', 'high', 'restricted');

-- CreateEnum
CREATE TYPE "DefaultAccessPolicy" AS ENUM ('private', 'workflow_scoped', 'approval_required', 'blocked_by_default');

-- CreateEnum
CREATE TYPE "MemorySourceType" AS ENUM ('user', 'agent', 'workflow', 'import', 'system');

-- CreateEnum
CREATE TYPE "MemoryAction" AS ENUM ('read', 'write', 'edit', 'delete', 'share', 'export', 'request_access');

-- CreateEnum
CREATE TYPE "AccessDecision" AS ENUM ('allowed', 'blocked', 'approval_required', 'approved', 'denied', 'revoked');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('active', 'expired', 'revoked', 'pending');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trust_score" INTEGER NOT NULL,
    "cost_per_task" INTEGER NOT NULL,
    "token_efficiency" INTEGER NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'draft',
    "weekly_budget_cents" INTEGER NOT NULL,
    "max_run_budget_cents" INTEGER NOT NULL,
    "approval_mode" "ApprovalMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_agents" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "role_in_workflow" TEXT NOT NULL,
    "route_order" INTEGER NOT NULL,
    "default_mode" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_partitions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID,
    "name" TEXT NOT NULL,
    "type" "MemoryPartitionType" NOT NULL,
    "sensitivity_level" "SensitivityLevel" NOT NULL,
    "description" TEXT NOT NULL,
    "default_access_policy" "DefaultAccessPolicy" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_partitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_items" (
    "id" UUID NOT NULL,
    "partition_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_type" "MemorySourceType" NOT NULL,
    "source_agent_id" UUID,
    "source_workflow_id" UUID,
    "sensitivity_level" "SensitivityLevel" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_access_grants" (
    "id" UUID NOT NULL,
    "partition_id" UUID NOT NULL,
    "agent_id" UUID,
    "workflow_id" UUID,
    "user_id" UUID NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_write" BOOLEAN NOT NULL DEFAULT false,
    "can_edit" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "can_share" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_access_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "partition_id" UUID NOT NULL,
    "memory_item_id" UUID,
    "agent_id" UUID,
    "workflow_id" UUID,
    "action" "MemoryAction" NOT NULL,
    "decision" "AccessDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "global_email_policy" TEXT NOT NULL,
    "global_payment_policy" TEXT NOT NULL,
    "global_memory_policy" TEXT NOT NULL,
    "premium_model_policy" TEXT NOT NULL,
    "data_sharing_policy" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoped_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID,
    "agent_id" UUID,
    "provider" TEXT NOT NULL,
    "credential_type" TEXT NOT NULL,
    "scope_description" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoped_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_key" ON "agents"("name");

-- CreateIndex
CREATE INDEX "workflows_user_id_idx" ON "workflows"("user_id");

-- CreateIndex
CREATE INDEX "workflow_agents_workflow_id_route_order_idx" ON "workflow_agents"("workflow_id", "route_order");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_agents_workflow_id_agent_id_key" ON "workflow_agents"("workflow_id", "agent_id");

-- CreateIndex
CREATE INDEX "memory_partitions_user_id_workflow_id_idx" ON "memory_partitions"("user_id", "workflow_id");

-- CreateIndex
CREATE INDEX "memory_partitions_sensitivity_level_idx" ON "memory_partitions"("sensitivity_level");

-- CreateIndex
CREATE INDEX "memory_items_partition_id_idx" ON "memory_items"("partition_id");

-- CreateIndex
CREATE INDEX "memory_items_user_id_idx" ON "memory_items"("user_id");

-- CreateIndex
CREATE INDEX "memory_access_grants_partition_id_idx" ON "memory_access_grants"("partition_id");

-- CreateIndex
CREATE INDEX "memory_access_grants_agent_id_idx" ON "memory_access_grants"("agent_id");

-- CreateIndex
CREATE INDEX "memory_access_grants_workflow_id_idx" ON "memory_access_grants"("workflow_id");

-- CreateIndex
CREATE INDEX "memory_access_grants_user_id_idx" ON "memory_access_grants"("user_id");

-- CreateIndex
CREATE INDEX "memory_access_logs_user_id_created_at_idx" ON "memory_access_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "memory_access_logs_partition_id_idx" ON "memory_access_logs"("partition_id");

-- CreateIndex
CREATE INDEX "policy_profiles_user_id_idx" ON "policy_profiles"("user_id");

-- CreateIndex
CREATE INDEX "scoped_credentials_user_id_idx" ON "scoped_credentials"("user_id");

-- CreateIndex
CREATE INDEX "scoped_credentials_workflow_id_idx" ON "scoped_credentials"("workflow_id");

-- CreateIndex
CREATE INDEX "scoped_credentials_agent_id_idx" ON "scoped_credentials"("agent_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_agents" ADD CONSTRAINT "workflow_agents_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_agents" ADD CONSTRAINT "workflow_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_partitions" ADD CONSTRAINT "memory_partitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_partitions" ADD CONSTRAINT "memory_partitions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_partition_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "memory_partitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_agent_id_fkey" FOREIGN KEY ("source_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_source_workflow_id_fkey" FOREIGN KEY ("source_workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_partition_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "memory_partitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_grants" ADD CONSTRAINT "memory_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_partition_id_fkey" FOREIGN KEY ("partition_id") REFERENCES "memory_partitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_memory_item_id_fkey" FOREIGN KEY ("memory_item_id") REFERENCES "memory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_access_logs" ADD CONSTRAINT "memory_access_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_profiles" ADD CONSTRAINT "policy_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_credentials" ADD CONSTRAINT "scoped_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_credentials" ADD CONSTRAINT "scoped_credentials_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoped_credentials" ADD CONSTRAINT "scoped_credentials_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
