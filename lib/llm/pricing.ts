import type { LlmUsage } from "./types";

// Per-model token prices in US cents per 1,000,000 tokens.
// Prices as of 2026-06-11 (Anthropic + OpenAI public pricing). These are
// illustrative defaults for cost display and cap enforcement; the actual model
// ids are env-overridable (ANTHROPIC_MODEL / OPENAI_MODEL), so an unknown id
// falls back to a conservative price below.
type ModelPrice = { inputCentsPerMillion: number; outputCentsPerMillion: number };

const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
  "gpt-4.1": { inputCentsPerMillion: 200, outputCentsPerMillion: 800 }
};

// Conservative fallback (highest of the known prices) so an unknown model never
// under-bills against the cost caps.
const FALLBACK_PRICE: ModelPrice = { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 };

export function priceForModel(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK_PRICE;
}

// Computed cost is rounded UP to whole cents: the DB column is an integer and we
// would rather slightly over-count than let a call slip under a cap.
export function computeCostCents(model: string, usage: LlmUsage): number {
  const price = priceForModel(model);
  const inputCost = (usage.inputTokens / 1_000_000) * price.inputCentsPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * price.outputCentsPerMillion;
  return Math.ceil(inputCost + outputCost);
}
