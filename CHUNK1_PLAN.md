# Chunk 1 Plan — Real Tool Catalog

## Registry Response Shape (empirically observed)

Endpoint: `GET https://registry.modelcontextprotocol.io/v0/servers?limit=100&isLatest=true`

```json
{
  "servers": [
    {
      "server": {
        "$schema": "...",
        "name": "ac.inference.sh/mcp",        // unique registry ID (namespace/slug)
        "title": "inference.sh",               // optional human display name
        "description": "Run 150+ AI apps...",
        "version": "1.0.1",
        "repository": {                         // optional
          "url": "https://github.com/...",
          "source": "github"
        },
        "packages": [                           // optional; npm/pypi/docker
          {
            "registryType": "pypi",
            "identifier": "adeu",
            "version": "1.5.2",
            "transport": { "type": "stdio" }
          }
        ],
        "remotes": [                            // optional; hosted HTTP endpoints
          { "type": "streamable-http", "url": "https://..." }
        ]
      },
      "_meta": {
        "io.modelcontextprotocol.registry/official": {
          "status": "active",
          "isLatest": true,
          "publishedAt": "2026-04-13T17:33:26.613537Z",
          "updatedAt": "2026-04-13T17:33:26.613537Z"
        }
      }
    }
  ],
  "metadata": {
    "nextCursor": "ai.bowmark/bowmark:3.18.1",
    "count": 100
  }
}
```

**Not in registry metadata**: tool lists, categories, risk levels, trust scores. Those are AgentDock curation judgments.

---

## Field Mapping (registry → McpServer columns)

| Registry field | McpServer column | Notes |
|---|---|---|
| `server.name` | `registryId` | Unique per source; e.g. "ac.inference.sh/mcp" |
| `"mcp-official-registry"` (constant) | `registrySource` | Distinguishes source |
| `server.title ?? server.name` | `displayName` | Use title if present, else name |
| `server.description` | `description` | |
| `server.repository.url` | `repositoryUrl` | Optional |
| `server.remotes[0].url` | `homepageUrl` | Optional; first remote URL |
| `server.packages[0].identifier` | `packageName` | Optional |
| `server.packages[0].registryType` | `packageRegistry` | npm/pypi/docker |
| `server.packages[0].version` | `version` | Optional |
| `_meta[...].updatedAt` | `lastSyncedAt` | Set at sync time |
| raw entry (full `{ server, _meta }`) | `registryRaw` | For audit |
| AgentDock assigned | `verificationStatus` | Always `"unverified"` for external |
| AgentDock assigned | `riskLevel` | `"medium"` default (conservative) |
| AgentDock assigned | `recommendedPermission` | `"approval_required"` default |

---

## Schema Changes Needed (Phase A)

1. Add `verificationStatus` enum: `verified | community | unverified` on `McpServer`
2. Add `recommendedPermission McpDefaultPermission` column (currently in `metadata` JSON — promote to proper column)
3. Add `registryRaw Json?` column
4. Add `packageInfo Json?` column (stores full packages array from registry)
5. Change `registryId @unique` → `@@unique([registrySource, registryId])` (allows same slug across different registries)
6. Remove `verified Boolean` and replace with `verificationStatus` enum (verified/community/unverified)
7. Migrate existing 6 curated servers: `verificationStatus: "verified"`, `registrySource: "agentdock-curated"`

---

## Pagination / Limit Strategy

- Use `isLatest=true` query param to skip historical versions (one entry per server name)
- Page size: 100 (registry max observed)
- Cap: first **5 pages = ~500 servers** for initial sync (registry has 1000+ total; 500 is enough to demonstrate real catalog without unbounded runtime)
- Cap is set in `lib/registry/officialMcp.ts` as `MAX_PAGES = 5`
- Re-running sync upserts by `[registrySource, registryId]` — idempotent

---

## Curation / Deny-by-Default Rules (Phase B)

Implemented in `lib/registry/normalize.ts`:
- External entries (registrySource = `"mcp-official-registry"`) → `verificationStatus: "unverified"`
- Default risk: `"medium"` (conservative; all external servers can execute code)
- Default permission: `"approval_required"` with no write/execute/delete
- If registry entry matches a curated entry (same packageName+packageRegistry or same repositoryUrl): curated judgment wins
- Curated entries: `verificationStatus: "verified"`, keep their specific riskLevel and permission

---

## Deferred Items

- **External servers' tool lists**: Registry metadata does not include tool lists. `McpTool` rows are only created for AgentDock-curated servers. External servers show 0 tools until executed (execution is out of scope).
- **Scheduled/background sync**: Manual-only for this chunk; sync button in Store UI.
- **Category inference**: Registry has no category field. External servers get `category: null`; Store can filter by null as "Uncategorized".
- **Full registry pagination** (1000+ servers): Capped at 500 for now. Can increase `MAX_PAGES` later.
