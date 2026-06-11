import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

// Selects a provider from env. ORCHESTRATOR_PROVIDER ("anthropic" | "openai")
// forces a choice; otherwise it defaults to whichever key is present, preferring
// Anthropic when both are set. Returns null when no key is configured — callers
// must handle that as the 503 "no model provider configured" path.
//
// No default here ever silently calls a provider: this only constructs the
// adapter; the network request happens later in the route.
export function getProvider(): LlmProvider | null {
  const preference = process.env.ORCHESTRATOR_PROVIDER?.toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (preference === "anthropic") {
    return anthropicKey ? createAnthropicProvider(anthropicKey) : null;
  }
  if (preference === "openai") {
    return openaiKey ? createOpenAiProvider(openaiKey) : null;
  }

  if (anthropicKey) return createAnthropicProvider(anthropicKey);
  if (openaiKey) return createOpenAiProvider(openaiKey);
  return null;
}

export { computeCostCents, priceForModel } from "./pricing";
export type { CompleteJsonParams, LlmCompletion, LlmProvider, LlmUsage } from "./types";
