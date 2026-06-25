// Read-only web search via the free, keyless DuckDuckGo HTML endpoint. This is
// the SAME logic the legacy in-process web-search tool used — now packaged so the
// first-party search MCP server can expose it as a `web_search` tool. Safe by
// construction: no writes, no auth to user resources, only the query string
// leaves. The result is plain text; the run engine treats it as UNTRUSTED data.

const SEARCH_TIMEOUT_MS = 10000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

// Extract result snippets from the DDG HTML search page.
function extractSnippets(html: string): string[] {
  const snippets: string[] = [];
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\//gi;
  let match: RegExpExecArray | null;
  while ((match = snippetRegex.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 20) snippets.push(text);
    if (snippets.length >= 8) break;
  }
  if (snippets.length === 0) {
    const altRegex = /class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\//gi;
    while ((match = altRegex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 20) snippets.push(text);
      if (snippets.length >= 8) break;
    }
  }
  if (snippets.length === 0) {
    const linkRegex = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = linkRegex.exec(html)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 10) snippets.push(text);
      if (snippets.length >= 8) break;
    }
  }
  return snippets;
}

export type SearchResult = { output: string; costCents: number };

export async function webSearch(query: string): Promise<SearchResult> {
  const q = query.slice(0, 256);
  const costCents = intEnv("RUN_TOOL_COST_CENTS", 0);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/html", "user-agent": "AgentDock/0.1 (research tool; free search API)" }
    });
    if (!res.ok) return { output: `Search returned status ${res.status}.`, costCents: 0 };

    const html = await res.text();
    const snippets = extractSnippets(html);

    if (snippets.length === 0) {
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&no_redirect=1&t=agentdock`;
      const iaRes = await fetch(iaUrl, { signal: controller.signal, headers: { accept: "application/json" } });
      if (iaRes.ok) {
        const data = (await iaRes.json()) as { AbstractText?: string; RelatedTopics?: { Text?: string }[] };
        const parts: string[] = [];
        if (data.AbstractText) parts.push(data.AbstractText);
        for (const topic of (data.RelatedTopics ?? []).slice(0, 5)) {
          if (topic?.Text) parts.push(topic.Text);
        }
        const text = sanitize(parts.join(" • ")).slice(0, 1500);
        return { output: text || `No results found for "${sanitize(q)}".`, costCents };
      }
      return { output: `No results found for "${sanitize(q)}". Try a shorter or more general query.`, costCents };
    }

    const output = snippets.map((s, i) => `${i + 1}. ${sanitize(s)}`).join("\n").slice(0, 2000);
    return { output: output || `No results for "${sanitize(q)}".`, costCents };
  } catch {
    return { output: "Search unavailable (network error or timeout).", costCents: 0 };
  } finally {
    clearTimeout(timer);
  }
}
