import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { createOpenRouterProvider } from "./openrouter";
import type { LlmProvider } from "./types";

// PROTOCOL_AUDIT C-1 / F-1 — DELIBERATE two-source model-key design (documented,
// not accidental drift):
//   • getProvider() (here) = the SYSTEM provider from env keys. It powers ONLY
//     flow *planning* (`POST /api/flows/plan`), so a user can plan a flow before
//     adding their own key — an onboarding capability.
//   • getRunProvider() (lib/execution/provider.ts) = the per-user BYO key, used
//     for real *runs*. Inference cost on a run is always the user's own.
// These are kept as two paths on purpose; collapsing them would remove
// plan-before-BYO onboarding. Founder decision F-1 in docs/PROTOCOL_AUDIT.md
// confirms keeping env-key planning as the system fallback.
//
// Selects a provider from env. ORCHESTRATOR_PROVIDER ("anthropic" | "openai" |
// "openrouter") forces a choice; otherwise it defaults to whichever key is
// present, preferring Anthropic, then OpenAI, then OpenRouter. Returns null when
// no key is configured — callers must handle that as the 503 "no model provider
// configured" path.
//
// No default here ever silently calls a provider: this only constructs the
// adapter; the network request happens later in the route.
export function getProvider(): LlmProvider | null {
  const preference = process.env.ORCHESTRATOR_PROVIDER?.toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  if (preference === "anthropic") {
    return anthropicKey ? createAnthropicProvider(anthropicKey) : null;
  }
  if (preference === "openai") {
    return openaiKey ? createOpenAiProvider(openaiKey) : null;
  }
  if (preference === "openrouter") {
    return openRouterKey ? createOpenRouterProvider(openRouterKey) : null;
  }

  if (anthropicKey) return createAnthropicProvider(anthropicKey);
  if (openaiKey) return createOpenAiProvider(openaiKey);
  if (openRouterKey) return createOpenRouterProvider(openRouterKey);
  return null;
}

export { computeCostCents, priceForModel } from "./pricing";
export type { CompleteJsonParams, LlmCompletion, LlmProvider, LlmUsage } from "./types";
