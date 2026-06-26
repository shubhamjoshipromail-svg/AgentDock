// Provider-neutral LLM contract. Cross-provider neutrality is a core product
// claim, so the rest of the app depends only on this interface — never on a
// specific SDK or REST shape.

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmCompletion = {
  text: string;
  usage: LlmUsage;
  costCents: number;
};

export type CompleteJsonParams = {
  system: string;
  user: string;
  maxOutputTokens: number;
  // Optional abort signal so the route (Phase F) owns the timeout policy.
  signal?: AbortSignal;
};

export type LlmProviderName = "anthropic" | "openai" | "openrouter";

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  completeJson(params: CompleteJsonParams): Promise<LlmCompletion>;
}
