import { computeCostCents } from "./pricing";
import type { CompleteJsonParams, LlmCompletion, LlmProvider } from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Current Claude Sonnet-class model. Override with ANTHROPIC_MODEL.
// Only Anthropic-hosted models are valid here — if the env contains a non-Anthropic
// model (e.g. leaked from a shell that runs a different AI tool), fall back to default.
const DEFAULT_MODEL = "claude-sonnet-4-6";
function resolveModel(): string {
  const fromEnv = process.env.ANTHROPIC_MODEL;
  if (!fromEnv) return DEFAULT_MODEL;
  // Guard: if the env model looks like a non-Anthropic model (another provider's
  // model leaked into the shell), ignore it and use the default.
  if (fromEnv.includes("deepseek") || fromEnv.includes("gpt") || fromEnv.includes("gemini")) {
    return DEFAULT_MODEL;
  }
  return fromEnv;
}
const TEMPERATURE = 0.2;

type AnthropicResponse = {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

function extractText(data: AnthropicResponse): string {
  if (!Array.isArray(data.content)) return "";
  return data.content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

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

export function createAnthropicProvider(
  apiKey: string,
  model = resolveModel()
): LlmProvider {
  return {
    name: "anthropic",
    model,
    async completeJson({ system, user, maxOutputTokens, signal }: CompleteJsonParams): Promise<LlmCompletion> {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        signal,
        headers: {
          // SECURITY: the API key travels only in this server-side request header.
          // It is never returned to the client and never written to any log line.
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: maxOutputTokens,
          temperature: TEMPERATURE,
          system,
          messages: [{ role: "user", content: user }]
        })
      });

      if (!response.ok) {
        throw new Error(`Anthropic request failed (${response.status}): ${await safeErrorText(response)}`);
      }

      const data = (await response.json()) as AnthropicResponse;
      const usage = {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0
      };

      return { text: extractText(data), usage, costCents: computeCostCents(model, usage) };
    }
  };
}
