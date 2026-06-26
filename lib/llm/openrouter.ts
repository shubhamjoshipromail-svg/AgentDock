import { computeCostCents } from "./pricing";
import type { CompleteJsonParams, LlmCompletion, LlmProvider } from "./types";

// OpenRouter is OpenAI-chat-compatible, so this provider mirrors the OpenAI one
// but targets OpenRouter's gateway and accepts a `sk-or-...` key. OpenRouter
// model ids are namespaced (vendor/model), e.g. "openai/gpt-4.1". The default is
// gpt-4.1 — among broadly-available models it is the strongest cost/outcome fit
// for agentic JSON tool-calling (cheaper and better at strict JSON than gpt-4o,
// cheaper than Sonnet). Override with OPENROUTER_MODEL.
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4.1";
const TEMPERATURE = 0.2;

type OpenRouterResponse = {
  choices?: { message?: { content?: string } }[];
  // OpenRouter returns OpenAI-style token counts; `cost` (USD) is included when
  // we request usage accounting, giving accurate cross-model cost.
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

async function safeErrorText(response: Response): Promise<string> {
  // Reads only the provider's response body — never request headers — so the
  // API key can never appear in a thrown/logged error.
  try {
    const body = await response.json();
    return body?.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export function createOpenRouterProvider(
  apiKey: string,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL
): LlmProvider {
  return {
    name: "openrouter",
    model,
    async completeJson({ system, user, maxOutputTokens, signal }: CompleteJsonParams): Promise<LlmCompletion> {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        signal,
        headers: {
          // SECURITY: the API key travels only in this server-side Authorization
          // header. It is never returned to the client and never logged.
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Optional attribution headers OpenRouter recommends (non-secret).
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://agentdock.local",
          "X-Title": process.env.OPENROUTER_SITE_NAME || "AgentDock"
        },
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          temperature: TEMPERATURE,
          // JSON output mode: the system prompt already instructs JSON-only output.
          response_format: { type: "json_object" },
          // Ask OpenRouter to return the actual USD cost in `usage.cost`.
          usage: { include: true },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter request failed (${response.status}): ${await safeErrorText(response)}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const usage = {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      };

      // Prefer OpenRouter's reported USD cost (accurate per model). Round UP to
      // whole cents so a call never slips under a cost cap. Fall back to the
      // local price table for the model id when no cost is returned.
      const costCents = typeof data.usage?.cost === "number" && data.usage.cost > 0
        ? Math.ceil(data.usage.cost * 100)
        : computeCostCents(model, usage);

      return {
        text: data.choices?.[0]?.message?.content ?? "",
        usage,
        costCents
      };
    }
  };
}
