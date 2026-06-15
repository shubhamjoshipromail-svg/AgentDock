import { createAnthropicProvider } from "../llm/anthropic";
import { createOpenAiProvider } from "../llm/openai";
import type { LlmProvider } from "../llm/types";
import { loadActiveProviderKey } from "./credentials";

// Builds the run-engine's model provider from the user's BYO key (server-only).
// The decrypted key lives only inside the provider closure for the duration of
// the run; it is never returned or logged. Tests mock this module to inject a
// queue-backed fake provider (no network, no key).
export async function getRunProvider(userId: string): Promise<LlmProvider | null> {
  const cred = await loadActiveProviderKey(userId);
  if (!cred) return null;
  return cred.provider === "anthropic"
    ? createAnthropicProvider(cred.apiKey)
    : createOpenAiProvider(cred.apiKey);
}
