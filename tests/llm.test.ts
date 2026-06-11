import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnthropicProvider } from "../lib/llm/anthropic";
import { createOpenAiProvider } from "../lib/llm/openai";
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

describe("getProvider selection", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
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
});
