-- Chunk 8 Phase 1: enforce one MCP access grant per (user, workflow, server).
-- Existing data may contain duplicate workflow-scoped grants (the old save path
-- used findFirst-then-create with no constraint), so collapse duplicates BEFORE
-- adding the unique index or the migration would fail on live data.

-- Keep the most recently updated row per (user_id, workflow_id, mcp_server_id);
-- delete the rest. Only workflow-scoped grants are de-duplicated — NULL
-- workflow_id grants (user/agent-scoped) are exempt and stay distinct.
DELETE FROM "mcp_access_grants" a
USING "mcp_access_grants" b
WHERE a."workflow_id" IS NOT NULL
  AND a."user_id" = b."user_id"
  AND a."workflow_id" = b."workflow_id"
  AND a."mcp_server_id" = b."mcp_server_id"
  AND (
    a."updated_at" < b."updated_at"
    OR (a."updated_at" = b."updated_at" AND a."id" < b."id")
  );

-- Enforce uniqueness. Postgres treats NULLs as distinct, so NULL workflow_id
-- grants are not constrained — matching the Prisma @@unique semantics.
CREATE UNIQUE INDEX "mcp_access_grants_user_id_workflow_id_mcp_server_id_key"
  ON "mcp_access_grants" ("user_id", "workflow_id", "mcp_server_id");
