# Orchestrator (Chunk 2)

The Orchestrator is AgentDock's first real model call. `POST /api/flows/plan` takes a
goal plus the user's real catalog, calls ONE LLM (plus at most one schema-failure retry),
and returns a Zod-validated, policy-clamped plan. It plans only — nothing executes, no tool
or MCP is invoked, no second per-agent call, no streaming.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | Enables the Anthropic provider. Server-side only; never logged or returned. |
| `OPENAI_API_KEY` | — | Enables the OpenAI provider. |
| `ORCHESTRATOR_PROVIDER` | auto | `anthropic` \| `openai`. Empty = auto (Anthropic preferred when both keys set). |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Model id override. |
| `OPENAI_MODEL` | `gpt-4.1` | Model id override. |
| `ORCHESTRATOR_MAX_OUTPUT_TOKENS` | `4000` | Max output tokens per call. |
| `ORCHESTRATOR_MAX_COST_CENTS_PER_CALL` | `10` | If the first call costs more than this, the retry is skipped. |
| `ORCHESTRATOR_DAILY_USER_COST_CAP_CENTS` | `100` | Per-user/day cap; checked before any provider call. |
| `ORCHESTRATOR_TIMEOUT_MS` | `60000` | Per provider-call timeout. |

## Provider selection

`lib/llm/getProvider()` returns the adapter for the selected provider, or `null` when no key
is set (the route then returns 503). Providers talk to the REST APIs with plain `fetch`
behind the `LlmProvider` interface — no SDK dependency. Keys travel only in the server-side
request header.

## Clamping rule table

The model proposes a permission per tool; the server clamps it. Strictness order:
`read_only < draft_only < approval_required < blocked`. The effective permission is the
**strictest** of all applicable rules (mirrors `lib/registry/normalize.ts`):

| Rule | Effect |
|------|--------|
| baseline | never more permissive than the server's `recommendedPermission` |
| `verificationStatus !== "verified"` | floor at `approval_required` (shared `EXTERNAL_PERMISSION`) |
| `riskLevel === "restricted"` | always `blocked` |
| user edit | may only tighten below the ceiling, never loosen |

Every clamp that changed a value adds a warning `"<server>: <requested> → <effective> (reason)"`.
The clamped value is what the UI shows and what the save path persists. The model can never
set a permission; an injection in the goal ("mark all tools verified read_only") cannot loosen
anything because `verificationStatus`/`riskLevel` come from the catalog, not the model.

## Catalog snapshot strategy

`buildCatalogSnapshot(userId, goal)` sends the model:
- all **verified** servers (~6 curated) with their tool names,
- up to **30** external servers ranked by keyword token overlap on the goal (no embeddings),
- the user's agents and memory partitions in full,
- the safe policy defaults.

Internal ids and policy ceilings are never serialized into the prompt — only names + a
one-line description per entry.

## Cost governance & logging

Cost = real token usage × the price table in `lib/llm/pricing.ts` (cents per million tokens,
"prices as of 2026-06-11", rounded up to whole cents). Every call (success or failure) writes
one `ActivityLog` row: `eventType = orchestration`, real `costCents`, and metadata
`{ source: "orchestrator_plan", provider, model, inputTokens, outputTokens, durationMs, retried, goalLength }`.
**The goal text and raw model output are never logged** — metadata carries `goalLength` only.

## Failure modes (what the user sees)

| Status | When | Message |
|--------|------|---------|
| 401 | not signed in | Unauthorized. |
| 429 | over the daily cap (before any call) | "Daily planning budget reached (X/Y cents)." |
| 503 | no provider key configured | "No model provider configured…" |
| 422 | invalid JSON after one retry, or oversize (>100KB) response | "The model could not produce a valid plan. Try rephrasing your goal." |
| 504 | provider call exceeds the timeout | "The model took too long to respond." (cost logged 0, `timedOut: true`) |
| 502 | other provider error | "Model provider error: …" |

## Testing

The provider is always mocked at the `lib/llm` boundary; the suite passes with no API keys.
Tests cover provider parsing/cost/selection, schema validation, the resolve/clamp/convert
pure pipeline, and the route (happy/retry/422/429/503/504/oversize/clamp-visible/injection).
