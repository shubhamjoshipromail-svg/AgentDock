-- Chunk 22 Phase 5: backfill mandate scope on existing grants.
--
-- The credential broker now treats scope as deny-by-default: a grant carrying no
-- scope authorizes nothing scoped. Previously the check short-circuited on a null
-- scope (`&& m.scope`), so a scopeless grant satisfied every action -- and since
-- no code path ever set scope, that was every grant.
--
-- A grant's authority is named by the canonical identity of the tool it grants
-- (serverKey:toolName), so the correct scope is derivable from the server row.
-- Backfilling keeps existing grants working; without it, every external send
-- would start failing closed after deploy.

UPDATE "mcp_access_grants" g
SET "scope" = s."mcp_server_key" || ':' || s."mcp_tool_name"
FROM "mcp_servers" s
WHERE g."mcp_server_id" = s."id"
  AND (g."scope" IS NULL OR btrim(g."scope") = '')
  AND s."mcp_server_key" IS NOT NULL
  AND s."mcp_tool_name" IS NOT NULL;
