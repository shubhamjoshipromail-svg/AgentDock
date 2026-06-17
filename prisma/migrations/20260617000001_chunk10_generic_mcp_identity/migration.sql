-- Chunk 10: generic MCP execution identity on mcp_servers. Additive + nullable
-- (isExternalSend defaults false), so existing rows stay valid. A row with
-- mcp_server_key set is a real connectable MCP tool; the name-prefix hack is
-- replaced by these columns.
ALTER TABLE "mcp_servers" ADD COLUMN "mcp_server_key" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "mcp_tool_name" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "credential_provider" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "is_external_send" BOOLEAN NOT NULL DEFAULT false;
