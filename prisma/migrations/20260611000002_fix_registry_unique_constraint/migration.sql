-- Replace the partial index (which Prisma upsert cannot use) with a
-- standard UNIQUE constraint on (registrySource, registryId).
-- Postgres UNIQUE constraints allow multiple NULL values in the same
-- column, so rows with NULL registryId are still permitted per source.

DROP INDEX IF EXISTS "mcp_servers_registry_source_registry_id_key";

ALTER TABLE "mcp_servers"
  ADD CONSTRAINT "mcp_servers_registry_source_registry_id_key"
  UNIQUE ("registry_source", "registry_id");
