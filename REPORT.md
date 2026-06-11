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

Stopping here. Registry ingestion, the model orchestrator, and real execution are
separate future tasks and were intentionally not started.
