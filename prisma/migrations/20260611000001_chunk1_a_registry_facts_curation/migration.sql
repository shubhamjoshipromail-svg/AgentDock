-- Phase A: Separate registry facts from AgentDock curation judgments.
-- Adds verificationStatus enum, recommendedPermission column, registryRaw,
-- packageInfo; drops the solo registryId unique in favour of (registrySource,
-- registryId); migrates verified boolean → verificationStatus enum.

-- CreateEnum
CREATE TYPE "McpVerificationStatus" AS ENUM ('verified', 'community', 'unverified');

-- Add new columns (nullable first so existing rows are unaffected)
ALTER TABLE "mcp_servers"
  ADD COLUMN "verification_status" "McpVerificationStatus" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "recommended_permission" "McpDefaultPermission" NOT NULL DEFAULT 'approval_required',
  ADD COLUMN "registry_raw" JSONB,
  ADD COLUMN "package_info" JSONB;

-- Migrate boolean verified → verificationStatus
UPDATE "mcp_servers" SET "verification_status" = 'verified' WHERE "verified" = true;
UPDATE "mcp_servers" SET "verification_status" = 'unverified' WHERE "verified" = false;

-- Migrate recommendedPermission from metadata JSON where available
UPDATE "mcp_servers"
  SET "recommended_permission" = (metadata->>'recommendedPermission')::"McpDefaultPermission"
  WHERE metadata->>'recommendedPermission' IS NOT NULL
    AND metadata->>'recommendedPermission' IN ('read_only','draft_only','approval_required','blocked');

-- Migrate registrySource for curated servers
UPDATE "mcp_servers"
  SET "registry_source" = 'agentdock-curated'
  WHERE "registry_source" = 'agentdock-curated-fallback';

-- Drop old solo unique on registry_id
DROP INDEX IF EXISTS "mcp_servers_registry_id_key";

-- Drop verified boolean (data migrated above)
ALTER TABLE "mcp_servers" DROP COLUMN "verified";

-- Create composite unique (registrySource, registryId) — allows same slug in
-- different registries; NULL registryId rows are excluded by Postgres semantics.
CREATE UNIQUE INDEX "mcp_servers_registry_source_registry_id_key"
  ON "mcp_servers"("registry_source", "registry_id")
  WHERE "registry_id" IS NOT NULL;

-- Index for fast verificationStatus filter
CREATE INDEX "mcp_servers_verification_status_idx" ON "mcp_servers"("verification_status");
