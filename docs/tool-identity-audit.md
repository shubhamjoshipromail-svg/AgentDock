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

