import { computeCostCents } from "./pricing";
import type { CompleteJsonParams, LlmCompletion, LlmProvider } from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// Current OpenAI model. Override with OPENAI_MODEL.
const DEFAULT_MODEL = "gpt-4.1";
const TEMPERATURE = 0.2;

type OpenAiResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
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

export function createOpenAiProvider(
  apiKey: string,
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL
): LlmProvider {
  return {
    name: "openai",
    model,
    async completeJson({ system, user, maxOutputTokens, signal }: CompleteJsonParams): Promise<LlmCompletion> {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        signal,
        headers: {
          // SECURITY: the API key travels only in this server-side Authorization
          // header. It is never returned to the client and never logged.
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: maxOutputTokens,
          temperature: TEMPERATURE,
          // JSON output mode: the system prompt already instructs JSON-only output.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status}): ${await safeErrorText(response)}`);
      }

      const data = (await response.json()) as OpenAiResponse;
      const usage = {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      };

      return {
        text: data.choices?.[0]?.message?.content ?? "",
        usage,
        costCents: computeCostCents(model, usage)
      };
    }
  };
}
