-- Chunk 16 Phase 1: a grantable tool must have one canonical executable
-- identity: mcp_server_key + mcp_tool_name, and the server key must resolve to
-- an enabled server_registration. Catalog-only rows may still exist, but they
-- cannot be attached/granted as executable tools.

-- First clean historical bad grants/attachments that pointed at metadata-only
-- catalog rows. They were never executable and produced "[unavailable]" at run
-- time, so preserving them would keep the bug alive.
DELETE FROM "mcp_access_grants" g
USING "mcp_servers" s
WHERE g."mcp_server_id" = s."id"
  AND (
    s."mcp_server_key" IS NULL
    OR s."mcp_tool_name" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "server_registrations" r
      WHERE r."server_key" = s."mcp_server_key"
        AND r."enabled" = true
    )
  );

DELETE FROM "workflow_mcps" wm
USING "mcp_servers" s
WHERE wm."mcp_server_id" = s."id"
  AND (
    s."mcp_server_key" IS NULL
    OR s."mcp_tool_name" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "server_registrations" r
      WHERE r."server_key" = s."mcp_server_key"
        AND r."enabled" = true
    )
  );

-- Keep lookup fast for canonical identity.
CREATE INDEX IF NOT EXISTS "mcp_servers_mcp_server_key_mcp_tool_name_idx"
  ON "mcp_servers"("mcp_server_key", "mcp_tool_name");

CREATE OR REPLACE FUNCTION "enforce_grantable_mcp_tool_identity"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "mcp_servers" s
    JOIN "server_registrations" r
      ON r."server_key" = s."mcp_server_key"
     AND r."enabled" = true
    WHERE s."id" = NEW."mcp_server_id"
      AND s."mcp_server_key" IS NOT NULL
      AND s."mcp_tool_name" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'MCP access grants require a registered executable tool identity (mcp_server_key + mcp_tool_name).';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "mcp_access_grants_require_executable_tool"
  ON "mcp_access_grants";

CREATE TRIGGER "mcp_access_grants_require_executable_tool"
  BEFORE INSERT OR UPDATE OF "mcp_server_id"
  ON "mcp_access_grants"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_grantable_mcp_tool_identity"();

