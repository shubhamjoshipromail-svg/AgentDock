-- CreateEnum
CREATE TYPE "McpRiskLevel" AS ENUM ('low', 'medium', 'high', 'restricted');

-- CreateEnum
CREATE TYPE "McpDefaultPermission" AS ENUM ('read_only', 'draft_only', 'approval_required', 'blocked');

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "registry_source" TEXT NOT NULL,
    "registry_id" TEXT,
    "homepage_url" TEXT,
    "repository_url" TEXT,
    "package_name" TEXT,
    "package_registry" TEXT,
    "version" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "risk_level" "McpRiskLevel" NOT NULL,
    "category" TEXT,
    "install_command" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tools" (
    "id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "input_schema" JSONB,
    "risk_level" "McpRiskLevel" NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_mcps" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "purpose" TEXT,
    "default_permission" "McpDefaultPermission" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_mcps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_access_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID,
    "agent_id" UUID,
    "mcp_server_id" UUID NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_write" BOOLEAN NOT NULL DEFAULT false,
    "can_execute" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "allowed_actions" JSONB,
    "blocked_actions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_name_key" ON "mcp_servers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_registry_id_key" ON "mcp_servers"("registry_id");

-- CreateIndex
CREATE INDEX "mcp_servers_risk_level_idx" ON "mcp_servers"("risk_level");

-- CreateIndex
CREATE INDEX "mcp_servers_category_idx" ON "mcp_servers"("category");

-- CreateIndex
CREATE INDEX "mcp_tools_mcp_server_id_idx" ON "mcp_tools"("mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tools_mcp_server_id_name_key" ON "mcp_tools"("mcp_server_id", "name");

-- CreateIndex
CREATE INDEX "workflow_mcps_workflow_id_idx" ON "workflow_mcps"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_mcps_mcp_server_id_idx" ON "workflow_mcps"("mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_mcps_workflow_id_mcp_server_id_key" ON "workflow_mcps"("workflow_id", "mcp_server_id");

-- CreateIndex
CREATE INDEX "mcp_access_grants_user_id_idx" ON "mcp_access_grants"("user_id");

-- CreateIndex
CREATE INDEX "mcp_access_grants_workflow_id_idx" ON "mcp_access_grants"("workflow_id");

-- CreateIndex
CREATE INDEX "mcp_access_grants_agent_id_idx" ON "mcp_access_grants"("agent_id");

-- CreateIndex
CREATE INDEX "mcp_access_grants_mcp_server_id_idx" ON "mcp_access_grants"("mcp_server_id");

-- AddForeignKey
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_mcps" ADD CONSTRAINT "workflow_mcps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_mcps" ADD CONSTRAINT "workflow_mcps_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_grants" ADD CONSTRAINT "mcp_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_grants" ADD CONSTRAINT "mcp_access_grants_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_grants" ADD CONSTRAINT "mcp_access_grants_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_access_grants" ADD CONSTRAINT "mcp_access_grants_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
