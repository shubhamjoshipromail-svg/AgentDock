-- Phase D: make Agent user-scoped.
-- Dev-prototype migration: existing agent rows (and their dependents, via
-- cascading FKs) are deleted because user_id is NOT NULL with no backfill
-- source. Run `npm run db:seed` afterwards to reproduce the demo data.
DELETE FROM "agents";

-- DropIndex
DROP INDEX "agents_name_key";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "user_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "agents_user_id_idx" ON "agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_user_id_name_key" ON "agents"("user_id", "name");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

