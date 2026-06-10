# Foundation Hardening Plan (Phases A–F)

Verified at `d6b1ab3`: monolithic `app/page.tsx` (3,128 lines, all sub-views + `Persisted*` types inline); `generateWorkflowDraft` ignores goal text; saves always POST `jobSearchWorkflowPayload`; Store attach targets `find(name === "Job Search Automation")`; simulate route is a hardcoded job-search script; `Agent.name` globally `@unique` with bootstrap upserts in 3 places; `GET /api/workflows` + `GET /api/memory` create data on read; no tests, no Zod.

## Environment deviation (flagged)
This machine has **no Docker, no Homebrew, no Postgres** — `docker-compose.yml` cannot be used as written, and `.env` pointed at a Railway cloud DB (violates "local only"). Fix: portable Postgres 16 binaries (Postgres.app bundle, includes pgvector) kept in a gitignored `.pgbin/` + `.pgdata/` inside the repo, run unprivileged on `localhost:5432` with `agentdock` + `agentdock_test` databases. `.env` switched to local (Railway URL backed up to `.env.railway.bak`, gitignored). If Docker is installed later, `docker compose up` works identically.

## Phase B move map (no behavior change)
- `lib/types.ts` — all `Persisted*` + domain types (`Section`, `AuditEvent`, `BuilderNode`, …); mock data constants → `lib/mock-data.ts`.
- `lib/api/client.ts` — typed wrappers: `listFlows`, `saveFlow`, `listRuns`, `simulateRun`, `resolveApproval`, `listActivity`, `listToolServers`, `syncToolCatalog`, `attachToolToFlow`, `patchToolGrant`, `revokeToolGrant`, `loadMemory`, `patchMemoryGrant`, `revokeMemoryGrant`.
- `components/layout/` — `AuthStatus`, `PageHeader`, `Card`, `Metric`, `MetricCard`, `DetailBlock`, `CapabilityBadge`, `ComingSoonButton`, `WorkflowMini`, `AuditList`, `ApprovalInbox`.
- `components/build/Builder.tsx` (+ palette helper `getBuilderPaletteItems`), `components/store/Store.tsx` (+ `WorkflowTemplateCard`), `components/flows/Library.tsx` (+ `KeysBilling`), `components/control/ControlPlane.tsx`, `components/profile/Profile.tsx` + `MemorySection.tsx`, `components/shared/` — `MemoryFirewallVisualizer`, `RouteView`, `RuntimeModeSection`, `Activity`, `Architecture` (the last five are currently unreferenced — moved verbatim, not deleted).
- `app/globals.css` split into per-area CSS files imported by their components; selectors/rules unchanged.
- `app/page.tsx` → thin shell: section state, nav, lifted demo-mode state passed down.

## Phase D schema change
`Agent`: add `userId String @db.Uuid` + `user` relation, replace `name @unique` with `@@unique([userId, name])` + `@@index([userId])`. Dev migration resets local data (acceptable; reseed via `db:seed`). Agent defaults deduped into `lib/catalog/agent-defaults.ts` (consumed by routes + seed). All bootstrap creation moves from GET routes into idempotent `POST /api/bootstrap`.

## Risks / notes
- Portable-Postgres bootstrap is the main environment risk (download availability, port 5432 conflicts).
- `prisma migrate dev` in Phase D resets dev data by design; Railway DB untouched.
- Builder local/demo (signed-out) mock behavior must stay intact through B & E; only the signed-in save/run path changes in E.
- Bugs noticed and deferred (for REPORT.md): `lib/auth-user.ts` falls back to email-only lookup; `pendingApprovals` adds a hardcoded `+3`; `Activity`/`Architecture`/`RouteView`/`RuntimeModeSection`/`MemoryFirewallVisualizer` are dead code in the render tree.
