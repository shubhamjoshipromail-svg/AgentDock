# Tool Identity Audit

Chunk 16 target: one canonical tool identity from catalog/discovery through grant,
prompt, executor dispatch, audit, and UI.

## Canonical Identity

The executable identity for a tool is the discovered MCP identity:

```text
mcpServerKey + mcpToolName
```

Examples:

- `search:web_search`
- `gmail:create_draft`
- `gmail:send_email`

This pair is the only value that proves a catalog row is executable. Display
names, registry ids, card names, and workflow labels are presentation metadata.

## Current Identity Surfaces

| Surface | Current Field | Example | Notes |
| --- | --- | --- | --- |
| Server registration | `ServerRegistration.serverKey` | `search`, `gmail` | Defines how the MCP server is reached. This is executable server identity. |
| Catalog/server row | `McpServer.name` | `search-mcp`, `gmail-create-draft` | Human/catalog slug. It has historically drifted from executable identity. |
| Catalog registry id | `McpServer.registrySource` + `registryId` | `agentdock:search-mcp`, `agentdock:discovered:gmail:send_email` | Upsert identity for catalog ingestion/discovery. Not an execution key. |
| Executable binding | `McpServer.mcpServerKey` + `mcpToolName` | `search` + `web_search` | The required canonical binding. Null values mean not executable. |
| Discovered tool row | one `McpServer` per tool | `gmail-send-email` | Discovery already writes canonical binding, but names can still duplicate curated rows. |
| Grant | `McpAccessGrant.mcpServerId` | FK to `McpServer` | Grants inherit whatever identity the catalog row has. Bad rows become bad grants. |
| Model prompt | `AllowedTool.toolName` | currently `mcpToolName` or fallback catalog name | The model must see exactly the executable `mcpToolName`. Fallback names are the risky seam. |
| Executor dispatch | `callMcpTool(serverKey, toolName, args)` | `callMcpTool("gmail", "send_email", args)` | This is the one real execution path. |
| Audit | event `metadata.toolName`, `resourceId`, `authorityRef` | `send_email`, server row id, grant id | Audit has the call name but not a single displayed canonical key yet. |

## Current Mismatches

- `lib/mcp-catalog.ts` still advertises old curated tool names such as
  `search_web`, while the executable search server exposes `web_search`.
- `McpServer.name` and `mcpToolName` are different concepts. The engine still
  allows matching by catalog name in addition to the canonical tool name, which
  makes hand-matching possible.
- The engine still has a fallback `toolNameFor(serverName)` path for rows with
  no `mcpToolName`. That lets a grant point at a non-executable row and fail at
  run time.
- `McpServer.mcpServerKey` and `mcpToolName` are nullable in the schema, so the
  database can persist grantable-looking rows that have no executable binding.
- The old `[unavailable] no MCP executor for this tool` branch is still reachable
  for null-keyed granted rows. Chunk 16 should make this impossible for grantable
  tools and treat any remaining runtime failure honestly.
- Some docs still mention the old `SERVER_REGISTRY` code constant even though
  server registration is now data-backed.
- Search has recently been bound to `search:web_search` in curated seed data,
  but old databases may still contain stale `search-mcp` rows or duplicate
  discovered/curated rows unless migrations/guards reconcile them.

## Unification Targets

1. A grantable `McpServer` row must have non-null `mcpServerKey` and
   `mcpToolName`.
2. The pair must resolve to an enabled `ServerRegistration`.
3. The model prompt should show the exact `mcpToolName`; the executor should
   dispatch only to `mcpServerKey + mcpToolName`.
4. Discovery and curated seed must converge on the same row for the same
   canonical pair.
5. Arguments should be coerced against the discovered `inputSchema` before
   dispatch.
6. Tool errors must terminate or pause honestly; they must never be reintroduced
   as a success signal.

## Resolution (Chunk 16 — shipped)

All six targets are closed. Adding the next tool is **register → connect →
discover → grant → run**, with no execution code.

1. **Grantable rows must carry a canonical identity.** A DB trigger
   (`enforce_grantable_mcp_tool_identity`, migration
   `20260626000001_chunk16_phase1_tool_identity_guard`) rejects any
   `McpAccessGrant` whose `McpServer` lacks `mcpServerKey`/`mcpToolName` or whose
   key does not resolve to an enabled `ServerRegistration`. The migration first
   deletes pre-existing invalid grants/attachments (GitHub/Docs/null-key rows).
2. **The pair must resolve to an enabled registration.** The same trigger joins
   `server_registrations` (`enabled = true`); the attach route
   (`/api/workflows/[id]/mcps`) returns `400 "… cannot be attached until it has a
   registered executable MCP identity"` instead of letting the guard throw.
3. **One name from prompt to dispatch.** `loadRunnable` filters to rows with a
   canonical identity and addresses each tool by its `mcpToolName` only — the
   `toolNameFor(serverName)` fallback is deleted. The model prompt shows
   `TOOL "<mcpToolName>"`; the executor dispatches `callMcpTool(mcpServerKey,
   mcpToolName, …)`. Model-facing name === dispatch identity.
4. **Discovery and seed converge.** Seed uses the discovered canonical identity
   (`gmail-create-draft`/`gmail-send-email`, `search:web_search`) so live
   discovery upserts the same rows — one row per canonical pair.
5. **Schema-aware argument coercion.** `lib/execution/tool-args.ts` coerces the
   model's output against the tool's discovered `inputSchema` (with a first-party
   canonical fallback) before dispatch: structured `arguments` are used directly;
   a legacy `input` string maps to the schema's single missing/primary string
   field (name read from the schema, never hardcoded to `query`); a multi-field
   tool given a bare string is an honest error naming the missing fields. A tool
   with required fields never receives `{}` or a partial object.
6. **Honest failures.** `executeAllowedTool` returns `{ text, runtimeError? }`. A
   genuine runtime tool error (the tool ran and reported an error, or the now-dead
   no-executor branch) halts the run `halted_error` with the real reason — never a
   fabricated "sent"/"completed", never a hallucinated fallback. `resultText`
   stays null. Missing-argument and governance/broker refusals are honest per-call
   failures that do not halt (the model may self-correct or continue). The
   `[unavailable]` branch is unreachable for grantable tools after target 1.

