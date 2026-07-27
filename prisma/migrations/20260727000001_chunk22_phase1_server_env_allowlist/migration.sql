-- Chunk 22 Phase 1: per-server environment allowlist (the isolation floor).
--
-- Before this, every spawned MCP server inherited the entire parent environment
-- (`{ ...process.env }`), which handed each tool process CREDENTIAL_ENCRYPTION_KEY
-- and DATABASE_URL together -- enough to decrypt every user's stored OAuth tokens
-- and BYO provider keys. A server now receives only a minimal safe base, the keys
-- its registration explicitly declares, and its brokered token.
--
-- Deny-by-default: the column defaults to the empty array, so a registration that
-- says nothing receives no host environment at all.

ALTER TABLE "server_registrations"
  ADD COLUMN "env_allowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
