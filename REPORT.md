# AgentDock — Foundation Hardening Report (Phases A–F)

The codebase moved from a convincing demo to a tested, validated, multi-tenant-correct
foundation that saves and simulates the flow the user actually builds. Backend
architecture, auth scopes, and the "plan + simulate" (no execution) posture are unchanged.

## What changed per phase

| Phase | Commit | Summary |
|-------|--------|---------|
| 0 | `67670f5` | `PLAN.md`: Phase B move map, Phase D schema change, risks. |
| A | `9f49cf7` | Vitest + `@vitest/coverage-v8`; `agentdock_test` DB; `.env.test` (gitignored); global setup runs `prisma migrate deploy`; per-test truncate helper; all routes resolve the user only via `lib/auth-user` (one mock point); 4 sanity integration tests. |
| B | `c603cfc` | `app/page.tsx` → thin shell (198 lines). Sub-views split into `components/{layout,build,store,flows,control,profile,shared}/`. `lib/types.ts` single source for `Persisted*`/domain types; `lib/api/client.ts` typed fetch wrappers; demo data in `components/mock-data.ts`. `globals.css` split into colocated per-area files imported in original cascade order (no visual change). |
| C | `b022e77` | Zod added. `lib/validation/schemas.ts` (one schema per input) + `lib/validation/parse.ts` helpers. Every route input `safeParse`s → `400 { message, issues }`. Client request types derived via `z.infer`. Validation tests for create-flow, simulate, grant-patch. |
| D | `35eadee` | `Agent` user-scoped (`userId` + `@@unique([userId, name])`); all upserts use the composite key. Agent defaults deduped into `lib/catalog/agent-defaults.js`. `GET /api/workflows` and `GET /api/memory` are pure reads; all starter-data creation moved to idempotent `POST /api/bootstrap`, called once per session via `BootstrapGate`. Isolation + idempotence + pure-read tests. |
| E | `174d0d7`, `63e7d7a` | `lib/catalog/templates.ts` is the single home for the Job Search demo. `POST /api/workflows` persists arbitrary agent stacks (creates user-defined agents), tool attachments, memory attachments, and serialized canvas `layout`. Builder serializes real canvas state (`components/build/serialize.ts`) instead of a constant. `POST /api/workflow-runs/simulate` rewritten generic: walks `workflowAgents` by `routeOrder` + one event per tool grant, decision derived from the grant permission, deterministic summed cost; all name string-matching deleted. Store "Add Tool" targets an explicit user-selected `workflowId`. |
| F | `3cb6ecd` | Generic user-facing copy normalized to Flow/Tool; rendered sections carry no generic "Workflow"/"MCP" labels. `api/client.ts` already exposes Flow/Tool verbs. `// TODO: rename DB models with @@map` left on the schema; no Prisma renames. |

## Phase D schema change & dev-data reset

- **Schema:** `Agent` gained `userId UUID NOT NULL` + `user` relation, `@@index([userId])`, and `@@unique([userId, name])` replacing the global `name @unique`. (Phase E later added a nullable `Workflow.layout Json?` column.)
- **Migrations:** `…_agent_user_scope` and `…_workflow_layout` under `prisma/migrations/`. The agent migration begins with `DELETE FROM "agents";` — a deliberate dev-prototype reset, because `user_id` is `NOT NULL` with no backfill source. Cascading FKs clear dependent rows.
- **Reseed:** `npm run db:seed` (`prisma/seed.js`) recreates the demo per-user from `lib/catalog/agent-defaults.js`. A fresh authenticated session also self-heals via the idempotent `POST /api/bootstrap`.

## Acceptance confirmation

- `npm run build` — passes (compiled successfully).
- `npm test` — passes (13 tests, 4 files).
- No external/model/network calls added: no MCP registry fetch, no LLM/model API, no credential minting, no agent/tool execution. Still plan + simulate only.
- `grep -ri "job search" app/api lib` — clean except the single definition in `lib/catalog/templates.ts`.
- Two mocked users get fully isolated agents/flows/memory/grants (test: `tests/api.integrity.test.ts`); a non-job-search flow with 2 arbitrary agents + 1 tool saves and simulates with events referencing exactly those agents/tools (test: `tests/api.simulate.test.ts`).

## Bugs / smells deliberately deferred

- **Hardcoded `+ 3` pending-approval count** — [app/page.tsx:85](app/page.tsx#L85): demo `pendingApprovals` adds a constant `+ 3` on top of the real count. Cosmetic demo-mode only; left untouched (signed-out demo behavior preserved).
- **Email-fallback user lookup** — [lib/auth-user.ts:17](lib/auth-user.ts#L17): `getCurrentUser` resolves by `id` OR `email`. Harmless with NextAuth's adapter but a wider match than necessary; revisit if email reuse becomes possible.
- **Dead UI components** — `components/shared/{Activity,Architecture,RouteView,RuntimeModeSection,MemoryFirewallVisualizer}.tsx` are not in the render tree (carried over verbatim from the monolith in Phase B). Either wire them in or delete; their internal copy still says lowercase "workflow".
- **DB model naming** — schema still uses `Workflow`/`Mcp*`; `// TODO: rename DB models with @@map` left in `prisma/schema.prisma`. The UI/TS boundary already says Flow/Tool.
- **Catalog vs install** — `// TODO: split catalog vs install` in `prisma/schema.prisma` and `app/api/workflows/route.ts`: long-term the Store should read a global read-only catalog with per-user installs; Phase D did the minimal correct per-user-ownership fix.
- **`prisma generate` adapter deprecation** — `pg` prints a `client.query()` deprecation warning under the test runner; cosmetic, not a failure.

## Run locally from a fresh clone

```bash
# 1. Postgres (docker-compose provides it; this machine used a portable Postgres
#    on the same localhost:5432 / agentdock credentials — see PLAN.md).
docker compose up -d

# 2. Install deps
npm install

# 3. Create the dev + test databases (docker-compose creates `agentdock`; also create the test DB)
#    e.g. createdb agentdock_test  (or: psql -c 'CREATE DATABASE agentdock_test;')

# 4. .env  -> DATABASE_URL=postgresql://agentdock:agentdock@localhost:5432/agentdock?schema=public
#    .env.test -> DATABASE_URL=postgresql://agentdock:agentdock@localhost:5432/agentdock_test?schema=public

# 5. Apply migrations + seed the demo
npx prisma migrate deploy
npm run db:seed

# 6. Run
npm run dev        # app at http://localhost:3000
npm run build      # production build
npm test           # integration tests (against agentdock_test)
```

> Environment note: this machine had no Docker/Homebrew/Postgres, so Phases A–F
> ran against a portable PostgreSQL 16 (pgvector included) under gitignored
> `.pgbin/` + `.pgdata/`, using the same connection string as `docker-compose.yml`.
> `docker compose up` works identically where Docker is available.

---

# Chunk 1 — Real Tool Catalog (MCP Registry Ingestion + Store Search)

## What changed per phase

| Phase | Commit | Summary |
|-------|--------|---------|
| 0 | `726097e` | `CHUNK1_PLAN.md`: registry shape observed empirically, field mapping table, schema changes needed, pagination strategy. |
| A | `9e7a7c5` | Schema separates registry facts from curation judgments: add `McpVerificationStatus` enum + `verificationStatus` column replacing `verified Boolean`; add `recommendedPermission` (promoted from metadata JSON), `registryRaw Json?`, `packageInfo Json?`; `@@unique([registrySource, registryId])` replacing solo `registryId @unique`; curated servers migrated to `registrySource: "agentdock-curated"`. |
| B | `072782d` | Real MCP registry ingestion: `lib/registry/{officialMcp,normalize,curated,types}.ts`; sync route rewritten with real fetch, deny-by-default curation, curated-wins merge, 502 on total failure; fix partial index → proper UNIQUE constraint. 24 tests pass. |
| C | `4aa8ee8` | Search/filter/paginate catalog API: `GET /api/mcp/servers` extended with `q`, `verification`, `source`, `cursor`/`limit`; returns `{servers, nextCursor, total}`; attach route defaults to `mcpServer.recommendedPermission`. 32 tests pass. |
| D | `8c421a8` | Store UI with real catalog and honest signals: debounced search, verification/risk filters, Load more, sync summary + lastSyncedAt; unverified servers show approval-required affordance; `trustScore`/`costPerTask`/`tokenEfficiency` removed from DB, Prisma schema, types, agent defaults, mock data, UI everywhere. |

## Registry response shape observed

```
GET https://registry.modelcontextprotocol.io/v0/servers?limit=100&isLatest=true

{ servers: [{ server: { name, title?, description?, version?, repository?: {url, source},
                         packages?: [{registryType, identifier, version, transport}],
                         remotes?: [{type, url}] },
              _meta: { "io.modelcontextprotocol.registry/official": { status, isLatest, updatedAt } } }],
  metadata: { nextCursor, count } }
```

See `CHUNK1_PLAN.md` for full field-mapping table.

## Ingestion cap

Capped at **5 pages × 100 = 500 servers** (`MAX_PAGES = 5` in `lib/registry/officialMcp.ts`).
The registry has 1,000+ total servers; 500 is enough to demonstrate the real catalog without
unbounded runtime. Increase `MAX_PAGES` when sync is moved to a background job.

## Curation / deny-by-default enforcement

**Where:** `lib/registry/normalize.ts:normalizeExternal()` — called by `lib/registry/officialMcp.ts`
for every registry entry before it reaches the sync route.

**Rules:**
- `verificationStatus: "unverified"` — always, regardless of registry metadata
- `riskLevel: "medium"` — conservative default for all external servers
- `recommendedPermission: "approval_required"` — no write/execute/delete
- Inactive entries (status ≠ "active") are skipped
- Curated entries (same package/repo) override external — `lib/registry/normalize.ts:curatedWins()`

The sync route never re-trusts or re-normalizes output from `fetchOfficialRegistry`;
the normalizer is the single enforcement gate.

## Deferred items

| Item | Rationale |
|------|-----------|
| External servers' tool lists | Registry metadata does not include tool lists; executing servers to discover tools is out of scope (no execution). External servers show 0 tools. |
| Scheduled/background sync | Manual-only (`POST /api/mcp/sync-registry`). Scheduled jobs are a later chunk. |
| Full registry pagination (1000+ servers) | Capped at 500. Increase `MAX_PAGES` in `lib/registry/officialMcp.ts`. |
| Category inference for external servers | Registry has no category field. External servers land with `category: null` ("Uncategorized" in UI). |

## Verification

```bash
# From a fresh clone (after DB setup per instructions above):

# Apply new migrations (chunk1 adds 3 new migrations)
npx prisma migrate deploy
DATABASE_URL="postgresql://agentdock:agentdock@localhost:5432/agentdock_test" npx prisma migrate deploy

# Run all tests (32 tests, 6 files)
npm test

# Production build
npm run build

# Manually sync the catalog (requires signed-in session):
# 1. Start dev server: npm run dev
# 2. Open http://localhost:3000 → sign in → Store → Tools tab → "Sync catalog"
# Expected: sync summary shows upserted count from official registry + 6 curated

# Confirm fake metrics are gone:
grep -ri "trustScore\|costPerTask\|tokenEfficiency" app components lib
# Expected: no output
```

## Constraints satisfied

- No execution, installation, or connection to any MCP server
- No LLM/model API calls
- No new auth added
- Sync is manual only (button), never on page load
- 502 on registry fetch failure; existing catalog unchanged
- All external entries land as unverified with approval_required permission
- `grep -ri "trustScore\|costPerTask\|tokenEfficiency" app components lib` returns nothing
- `npm run build` and `npm test` (32/32) pass
