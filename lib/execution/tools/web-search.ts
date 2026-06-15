import type { ToolExecution } from "./registry";

// ONE real tool: read-only web search. Safe by construction — no writes, no auth
// to user resources, no PII egress (only the query string leaves). Uses the free,
// keyless DuckDuckGo Instant Answer API. The result is returned as plain text and
// is treated as UNTRUSTED data by the run engine (tagged + delimited); it is
// never executed as instructions.

const SEARCH_TIMEOUT_MS = 8000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Strip control characters / collapse whitespace so a result can't smuggle
// terminal escapes or odd framing back into the prompt.
function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

type DdgResponse = {
  AbstractText?: string;
  Heading?: string;
  RelatedTopics?: { Text?: string }[];
};

export async function webSearch(query: string): Promise<ToolExecution> {
  const q = query.slice(0, 256);
  const costCents = intEnv("RUN_TOOL_COST_CENTS", 0); // DDG IA is free; fixed cost is env-tunable.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1&t=agentdock`;
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) return { output: `Search returned status ${res.status}.`, costCents: 0 };
    const data = (await res.json()) as DdgResponse;

    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    for (const topic of (data.RelatedTopics ?? []).slice(0, 6)) {
      if (topic?.Text) parts.push(topic.Text);
    }
    const text = sanitize(parts.join(" • ")).slice(0, 1500);
    return { output: text || `No instant-answer results for "${sanitize(q)}".`, costCents };
  } catch {
    return { output: "Search unavailable (network error or timeout).", costCents: 0 };
  } finally {
    clearTimeout(timer);
  }
}
