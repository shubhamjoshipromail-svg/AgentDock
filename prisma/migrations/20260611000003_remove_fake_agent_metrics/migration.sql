-- Remove trustScore, costPerTask, tokenEfficiency from agents.
-- These were invented numbers with no real backing data — they appeared in
-- the Store, Builder inspector, and simulation cost events. Removing them
-- prevents misleading users with fabricated credibility signals.
ALTER TABLE "agents"
  DROP COLUMN IF EXISTS "trust_score",
  DROP COLUMN IF EXISTS "cost_per_task",
  DROP COLUMN IF EXISTS "token_efficiency";
