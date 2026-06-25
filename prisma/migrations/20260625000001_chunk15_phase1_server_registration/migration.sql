-- Chunk 15 Phase 1: server registration AS DATA.
-- A ServerRegistration defines how to launch/reach an MCP server (a vetted local
-- stdio command, or a remote http/sse url) and which credential broker entry /
-- env var it needs. Connectability, transport, token env, display label and auth
-- provider are read from these rows instead of a code constant. Rows are
-- seed/admin-curated only — there is no user-facing endpoint to register an
-- arbitrary local command (that would be RCE).

CREATE TYPE "ServerTransport" AS ENUM (
  'stdio',
  'http',
  'sse'
);

CREATE TABLE "server_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "server_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "transport" "ServerTransport" NOT NULL DEFAULT 'stdio',
  "command" TEXT,
  "args" JSONB,
  "url" TEXT,
  "credential_provider" TEXT,
  "token_env_var" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "curated" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "server_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "server_registrations_server_key_key" ON "server_registrations"("server_key");
CREATE INDEX "server_registrations_enabled_idx" ON "server_registrations"("enabled");
