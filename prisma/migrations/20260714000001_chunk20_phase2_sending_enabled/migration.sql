-- Chunk 20 Phase 2: draft-only default for new users.
-- New users may create drafts (approval-gated) but cannot be granted a real
-- external send until they deliberately enable sending. Defaults to false for
-- everyone; existing send grants are not touched (this gates NEW send-grant
-- creation, not runtime enforcement of grants already issued).
ALTER TABLE "users" ADD COLUMN "sending_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Grandfather existing senders: any user who already holds an active external-
-- send grant has effectively opted in already, so keep their posture unchanged
-- (their grants are untouched). New users have no such grant and stay draft-only.
UPDATE "users" u
SET "sending_enabled" = true
WHERE EXISTS (
  SELECT 1
  FROM "mcp_access_grants" g
  JOIN "mcp_servers" s ON s."id" = g."mcp_server_id"
  WHERE g."user_id" = u."id"
    AND s."is_external_send" = true
    AND g."revoked_at" IS NULL
);
