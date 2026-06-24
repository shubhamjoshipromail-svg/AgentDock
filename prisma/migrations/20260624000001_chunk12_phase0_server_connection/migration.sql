-- Chunk 12 Phase 0: per-user server connection lifecycle.
-- A ServerConnection tracks one user's connection to an MCP server,
-- independent of other users' connections to the same server.
-- Secrets (tokens, keys) are never stored here — they stay in
-- ScopedCredential via the existing credential broker.

CREATE TYPE "ConnectionStatus" AS ENUM (
  'registered',
  'connecting',
  'connected',
  'discovered',
  'error',
  'disconnected'
);

CREATE TABLE "server_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "server_key" TEXT NOT NULL,
  "label" TEXT,
  "transport_config" JSONB,
  "auth_provider" TEXT,
  "status" "ConnectionStatus" NOT NULL DEFAULT 'registered',
  "last_discovered_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "server_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "server_connections_user_id_server_key_key" ON "server_connections"("user_id", "server_key");
CREATE INDEX "server_connections_user_id_idx" ON "server_connections"("user_id");
CREATE INDEX "server_connections_status_idx" ON "server_connections"("status");

ALTER TABLE "server_connections"
  ADD CONSTRAINT "server_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
