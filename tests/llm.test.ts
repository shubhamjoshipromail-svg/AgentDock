import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnthropicProvider } from "../lib/llm/anthropic";
import { createOpenAiProvider } from "../lib/llm/openai";
import { createOpenRouterProvider } from "../lib/llm/openrouter";
import { getProvider } from "../lib/llm";
import { computeCostCents, priceForModel } from "../lib/llm/pricing";

// All provider tests mock fetch — no network, no real keys. The suite passes
// with no provider keys configured.
const originalFetch = global.fetch;

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => payload
  })) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("pricing", () => {
  it("computes cost from usage, rounding up to whole cents", () => {
    // 1,000,000 input @ 300c/M + 1,000,000 output @ 1500c/M = 1800 cents
    expect(computeCostCents("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(1800);
    // tiny call rounds up rather than to zero (0.3c + 0.75c = 1.05c -> 2c)
    expect(computeCostCents("claude-sonnet-4-6", { inputTokens: 1000, outputTokens: 500 })).toBe(2);
  });

  it("falls back to a conservative price for unknown models", () => {
    expect(priceForModel("some-unknown-model")).toEqual(priceForModel("claude-sonnet-4-6"));
  });
});

describe("anthropic provider", () => {
  it("parses text + usage and computes cost", async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: "text", text: "{\"ok\":true}" }],
      usage: { input_tokens: 1200, output_tokens: 800 }
    });

    const provider = createAnthropicProvider("test-key", "claude-sonnet-4-6");
    const result = await provider.completeJson({ system: "s", user: "u", maxOutputTokens: 1000 });

    expect(result.text).toBe("{\"ok\":true}");
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 800 });
    expect(result.costCents).toBe(computeCostCents("claude-sonnet-4-6", { inputTokens: 1200, outputTokens: 800 }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never leaks the key in a thrown error on non-ok responses", async () => {
    mockFetchOnce({ error: { message: "rate limited" } }, false, 429);
    const provider = createAnthropicProvider("super-secret-key", "claude-sonnet-4-6");

    await expect(provider.completeJson({ system: "s", user: "u", maxOutputTokens: 10 }))
      .rejects.toThrow(/Anthropic request failed \(429\): rate limited/);
    await expect(provider.completeJson({ system: "s", user: "u", maxOutputTokens: 10 }).catch((e) => e.message))
      .resolves.not.toContain("super-secret-key");
  });
});

describe("openai provider", () => {
  it("parses content + usage and computes cost", async () => {
    mockFetchOnce({
      choices: [{ message: { content: "{\"plan\":1}" } }],
      usage: { prompt_tokens: 500, completion_tokens: 250 }
    });

    const provider = createOpenAiProvider("test-key", "gpt-4.1");
    const result = await provider.completeJson({ system: "s", user: "u", maxOutputTokens: 1000 });

    expect(result.text).toBe("{\"plan\":1}");
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 250 });
    expect(result.costCents).toBe(computeCostCents("gpt-4.1", { inputTokens: 500, outputTokens: 250 }));
  });
});

describe("openrouter provider", () => {
  it("targets the OpenRouter gateway with the sk-or key and parses content + usage", async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { content: "{\"plan\":2}" } }],
      usage: { prompt_tokens: 500, completion_tokens: 250 }
    });

    const provider = createOpenRouterProvider("sk-or-test-key", "openai/gpt-4.1");
    const result = await provider.completeJson({ system: "s", user: "u", maxOutputTokens: 1000 });

    expect(provider.name).toBe("openrouter");
    expect(result.text).toBe("{\"plan\":2}");
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 250 });
    // Request went to OpenRouter, not OpenAI, with the user's key in the header.
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(String(url)).toContain("openrouter.ai/api/v1/chat/completions");
    expect(JSON.stringify(init.headers)).toContain("sk-or-test-key");
  });

  it("uses OpenRouter's reported USD cost (rounded up to cents) when present", async () => {
    mockFetchOnce({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 } // $0.0123 -> 2c
    });
    const provider = createOpenRouterProvider("sk-or-x", "anthropic/claude-sonnet-4.5");
    const result = await provider.completeJson({ system: "s", user: "u", maxOutputTokens: 10 });
    expect(result.costCents).toBe(2);
  });

  it("falls back to the local price table when no cost is reported", async () => {
    mockFetchOnce({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } // no cost field
    });
    const provider = createOpenRouterProvider("sk-or-x", "some/unknown-model");
    const result = await provider.completeJson({ system: "s", user: "u", maxOutputTokens: 10 });
    expect(result.costCents).toBe(computeCostCents("some/unknown-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 }));
  });

  it("never leaks the key in a thrown error on non-ok responses", async () => {
    mockFetchOnce({ error: { message: "insufficient credits" } }, false, 402);
    const provider = createOpenRouterProvider("sk-or-super-secret", "openai/gpt-4.1");
    await expect(provider.completeJson({ system: "s", user: "u", maxOutputTokens: 10 }).catch((e) => e.message))
      .resolves.not.toContain("sk-or-super-secret");
  });
});

describe("getProvider selection", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "");
  });

  it("returns null when no key is configured", () => {
    expect(getProvider()).toBeNull();
  });

  it("prefers anthropic when both keys are present", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(getProvider()?.name).toBe("anthropic");
  });

  it("uses the only key present", () => {
    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(getProvider()?.name).toBe("openai");
  });

  it("honors ORCHESTRATOR_PROVIDER and returns null if its key is missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "openai");
    expect(getProvider()).toBeNull();

    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(getProvider()?.name).toBe("openai");
  });

  it("selects OpenRouter when it is the only key, and honors the forced preference", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-x");
    expect(getProvider()?.name).toBe("openrouter");

    // Forced preference with its key present wins.
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "openrouter");
    expect(getProvider()?.name).toBe("openrouter");
  });
});
