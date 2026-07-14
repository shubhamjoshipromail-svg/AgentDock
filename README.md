# AgentDock

AgentDock is a prototype control plane for building, governing, previewing, and
monitoring multi-agent Flows across model providers and MCP tools.

The product is deliberately split into two modes:

- **Build:** describe an outcome, generate or load a Flow, inspect its agents,
  tools, memory, approvals, and budget, save it, and run a preview
  (`/api/workflow-runs/simulate`) of the flow you are authoring.
- **Control:** a calm board of your real governed runs. Each run is a card;
  open one to see its **Output** (the deliverable) separated from its
  **Process** (the collapsible step log), resolve approvals, inspect policy
  decisions, and monitor spend. Control shows real runs only — no simulated
  previews or demo data.

AgentDock has a real identity and policy-data plane. It can persist users,
Flows, agents, tool grants, memory grants, model-planning costs, preview runs,
approvals, and activity. It also has an early real-run path: a signed-in user can
store an encrypted BYO Anthropic/OpenAI key, run saved Flow agents through real
model calls, use the legacy read-only Search tool, and route registered MCP
tools through a governed MCP client. The first connected MCP server is a
first-party Gmail server; `create_draft` can create real drafts, while
`send_email` is always approval-gated before any outbound send.

## Project Status

AgentDock is past static demo stage. It is now a working prototype of the
control-plane data path, with a deliberately narrow real execution surface.

| Area | Status | Notes |
|---|---|---|
| Auth + tenancy | Complete for prototype | Google/Auth.js sessions, user-owned rows, ownership checks. |
| Flow Builder | Mostly complete | Model-backed planning, permission clamp, save/load, persisted graph hydration. |
| Flow truth | Complete for prototype | Saving reconciles agents/tools/memory so removed grants do not linger. |
| Real run engine | Prototype complete | Sequential agents, BYO model calls, bounded cost/steps/tools, kill switch. |
| A2A handoff | Internal v1 complete | Agent outputs hand off as capped untrusted context; not external A2A protocol yet. |
| A2UI / Control | Prototype complete | Real run board, output/process split, approval inbox, run events. |
| MCP catalog | Complete for prototype | Official registry metadata + curated entries, search/filter/pagination. |
| Governed MCP execution | Early v1 | Official SDK client, registered servers only, first-party Gmail server connected. |
| Memory Firewall | Prototype complete | Zones, grants, logs, runtime read bounding; no semantic retrieval yet. |
| Access Gateway | Early v1 | Encrypted BYO model keys and encrypted Google OAuth token bundles. Not KMS/Vault yet. |
| Durable execution + worker | **Chunk 11 complete** | Postgres-backed job queue, standalone worker process, crash recovery, idempotent external actions, step-cursor resume, SSE event streaming, per-user concurrency bound, explicit sandbox seam. |
| Sandbox / isolation | Not built | Sandbox boundary is defined in code (`callMcpTool` seam); actual container/VM isolation not yet implemented. |
| Billing/payments | Not built | No provider resale, Stripe, org billing, or spend reconciliation yet. |
| External agents / NANDA | Not built | No third-party agent runtime, discovery trust network, or cross-org agent identity yet. |

**Chunk 11 (Durable Execution) has shipped.** Real runs are now enqueued via a
Postgres-backed job queue and executed by a standalone worker process with crash
recovery, idempotent external actions, step-cursor resume, and event streaming —
see [docs/durable-execution.md](docs/durable-execution.md) for the full design.

## Current Product Surface

The main navigation is:

- **Build** — model-backed Flow planning, templates, editable permissions,
  graph visualization, save, and run preview.
- **Store** — agents, the official MCP registry catalog, curated tools, search,
  filters, pagination, and Flow attachment.
- **Flows** — saved Flows, their agents, attached tools, graph detail, and
  scoped-access controls.
- **Control** — a board of real-run cards (flow name, status, cost, step/tool
  counts, output preview). Opening a run separates Output (the deliverable)
  from a collapsed Process log of per-agent steps; heavy payloads sit behind a
  per-step "Show details". Plus an approval inbox and spend, computed from real
  runs only.
- **Profile** — identity, policy defaults, budget defaults, and Memory Zones.

The interface uses a dark control-tower design. Monospace text marks
machine-derived values such as tokens, costs, timestamps, IDs, and decisions.
Risk and decision colors are consistent across the graph, catalog, and
Timeline.

## What Is Real

- Google identity through Auth.js and database sessions.
- User-scoped agents, Flows, memory, grants, runs, approvals, and Timeline
  entries in Postgres.
- Idempotent per-user workspace bootstrap after sign-in.
- Natural-language Flow planning through Anthropic or OpenAI when a provider
  key is configured.
- Zod validation of model output and all mutable API inputs.
- Server-side resolution and permission clamping before a generated plan
  reaches the UI.
- Saving the exact generated or manually assembled Flow, including agents,
  tools, memory attachments, permission choices, and serialized layout.
- Generic database-backed run previews based on the saved Flow.
- Real governed runs using encrypted BYO provider keys.
- Real read-only Search MCP execution through DuckDuckGo Instant Answer.
- Re-gated approval resume semantics: approval does not bypass current policy.
- Resolving an approval as **edited** cleanly halts the paused run (it does not
  execute the pending action and does not silently resume); re-run the flow to
  apply the updated policy.
- MCP revocation with `revokedAt` kill-switch semantics.
- Durable run execution via Postgres-backed job queue with crash recovery.
- Standalone worker process (npm run worker) with lease/heartbeat.
- Idempotent external actions — a retried step never double-fires a real-world effect.
- Step-cursor resume — a reclaimed job resumes from the last completed agent.
- SSE event streaming at `GET /api/runs/:id/stream` (additive to polling).
- Per-user concurrency bound (safety cap, not throughput feature).
- Explicit sandbox boundary at the `callMcpTool` seam.
- Memory approval-required grants are skipped and logged, not silently injected.
- Approval resolution with persisted audit events.
- Memory grant editing and revocation.
- Official MCP Registry metadata ingestion plus AgentDock-curated entries.
- Tool catalog search, verification/risk filters, pagination, Flow attachment,
  permission editing, and revocation.
- Automated integration and pipeline tests against a separate Postgres test
  database.

## What Is Still Simulated or Disabled

- External/third-party agent execution.
- Arbitrary third-party MCP server installation/execution.
- MCP tool invocation beyond the legacy Search tool and the registered
  first-party Gmail MCP server.
- Calendar, Drive, GitHub, Stripe, or arbitrary account connections.
- Calendar, Drive, GitHub, Stripe, or other write-capable tool execution beyond
  Gmail draft/send under AgentDock approval policy.
- Runtime containers or sandbox hosting.
- Real credential minting and provider-key proxying.
- Billing and payment collection.
- Embedding generation and semantic memory retrieval.

`POST /api/flows/plan` is the model-backed planning surface. `/api/runs` is the
real governed run surface for saved Flows with a user BYO provider key.

## Architecture

```text
User / A2UI Control
        |
        v
Flow Builder + Orchestrator
        |
        v
Policy Resolution + Permission Clamping
        |
        +--> Memory Firewall
        +--> Scoped Tool Grants
        +--> Budget / Approval Gates
        |
        v
Saved Flow in Postgres
        |
        v
POST /api/runs → WorkflowRun + RunJob (queued) → HTTP 201 (immediate)
                                              |
                                              v
                              ┌───────────────────────────────┐
                              │  Postgres Queue (run_jobs)     │
                              │  SELECT … FOR UPDATE SKIP      │
                              │  LOCKED, per-user concurrency  │
                              └──────────────┬────────────────┘
                                             │
                              ┌──────────────┴────────────────┐
                              │  Worker (npm run worker)       │
                              │  - Claim → heartbeat → execute │
                              │  - Crash recovery              │
                              │  - Idempotent external actions │
                              │  - Step-cursor resume          │
                              └──────────────┬────────────────┘
                                             │
                              ┌──────────────┴────────────────┐
                              │  Run Engine (drive)            │
                              │  - Policy gate                 │
                              │  - Cap enforcement             │
                              │  - Kill switch                 │
                              │  - Memory firewall             │
                              └──────────────┬────────────────┘
                                             │
                              ┌──────────────┴────────────────┐
                              │  Sandbox Seam (callMcpTool)    │
                              │  - MCP tool execution          │
                              │  - (Future: isolated executor) │
                              └───────────────────────────────┘
        |
        v
Run Events + Approvals + Activity Log
        |
        v
SSE Stream (GET /api/runs/:id/stream) → live Control board
```

The intended production architecture extends this with an Access Gateway,
runtime/sandbox, agent router, MCP Gateway, and real tool/model execution.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Auth.js / NextAuth with Google OAuth
- Prisma 7
- PostgreSQL 16
- pgvector extension
- Zod
- Vitest
- Anthropic and OpenAI REST APIs through server-side `fetch`

## Repository Structure

```text
app/
  api/                 Auth, bootstrap, planning, Flows, runs, approvals,
                       memory, activity, and MCP catalog/grant routes
  page.tsx             Thin application shell and shared local demo state
  tokens.css           Design tokens
  base.css             Global reset and base rules
  elevation.css        Surface/elevation rules

components/
  a2ui/                Unified event-card grammar
  build/               Builder, Flow Graph, serialization, graph layout
  control/             Control dashboard and approval operations
  flows/               Saved Flow library
  layout/              Shell, navigation, auth menu, command palette, toasts
  profile/             Profile and Memory Zones
  store/               Agent/tool/template catalog

lib/
  api/                 Typed client wrappers
  catalog/             Starter agents and Flow templates
  llm/                 Anthropic/OpenAI adapters and pricing
  orchestrator/        Schema, prompt, snapshot, resolve, clamp, conversion
  registry/            Official MCP Registry fetch and normalization
  validation/          Zod request schemas and parsing helpers

prisma/
  schema.prisma        Product and Auth.js data model
  migrations/          Database migrations
  seed.js              Demo seed

tests/                 API, isolation, validation, registry, LLM, and
                       orchestrator tests
```

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the environment file

```bash
cp .env.example .env
```

At minimum, configure:

```bash
DATABASE_URL="postgresql://agentdock:agentdock@localhost:5432/agentdock?schema=public"
AUTH_SECRET=""
AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Generate an Auth secret with:

```bash
openssl rand -base64 32
```

### 3. Start Postgres

The included Docker Compose service uses PostgreSQL 16 with pgvector:

```bash
docker compose up -d
```

### 4. Apply migrations and seed

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

### 5. Start AgentDock

```bash
# Terminal 1: Next.js dev server (UI + API)
npm run dev

# Terminal 2: Worker process (claims and executes queued runs)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000).

The worker is a standalone process — no Next.js dependency. It loops: claim a
queued job → heartbeat continuously → execute via the run engine → release. It
respects a per-user concurrency cap (default: 1) so a single user can never
flood the queue. Configurable via environment variables:

- `WORKER_POLL_MS` — poll interval when idle (default: 2000)
- `WORKER_LEASE_MS` — job lease duration (default: 60000)
- `WORKER_PER_USER_CONCURRENCY` — max concurrent runs per user (default: 1)

Use `localhost` consistently for the browser, `AUTH_URL`, Google authorized
origin, and Google callback. Mixing `localhost` and `127.0.0.1` can break OAuth
cookies and callback validation.

## Google OAuth

By default, AgentDock requests identity scopes only:

```text
openid email profile
```

In Google Cloud, configure:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI:
  `http://localhost:3000/api/auth/callback/google`

AgentDock does not request Gmail, Calendar, Drive, or other Workspace scopes.

For the optional first-party Gmail MCP demo, the founder can add:

```text
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.send
```

Those scopes are not used for general login. They are only needed if you want to
run the first-party Gmail MCP server locally. The encrypted Google token bundle
is stored server-side and injected only into the Gmail MCP process environment.

## Optional Model-Backed Planning

Provide one provider key to enable **Plan flow**:

```bash
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
```

Provider selection:

```bash
# "anthropic" or "openai"; empty chooses an available provider and prefers Anthropic
ORCHESTRATOR_PROVIDER=""

# Optional overrides
ANTHROPIC_MODEL=""
OPENAI_MODEL=""
```

Defaults:

- Anthropic model: `claude-sonnet-4-6`
- OpenAI model: `gpt-4.1`
- Maximum output: 4,000 tokens
- Maximum cost before skipping a schema retry: 10 cents
- Per-user daily planning cap: 100 cents
- Provider timeout: 60 seconds

Optional governance variables:

```bash
ORCHESTRATOR_MAX_OUTPUT_TOKENS=4000
ORCHESTRATOR_MAX_COST_CENTS_PER_CALL=10
ORCHESTRATOR_DAILY_USER_COST_CAP_CENTS=100
ORCHESTRATOR_TIMEOUT_MS=60000
```

If no provider key is configured, planning returns `503` and the rest of the
application remains available.

### Planning safety

The model receives a bounded catalog snapshot:

- All verified curated tools.
- Up to 30 relevant external registry servers.
- The signed-in user's agents.
- The signed-in user's Memory Zones.
- Safe default policy rules.

Model output must match the FlowPlan Zod schema. References that do not exist in
the catalog are dropped, agent order is normalized, and tool permissions are
clamped server-side.

Permission strictness is:

```text
read_only < draft_only < approval_required < blocked
```

The final permission is never looser than:

- The tool's recommended permission.
- `approval_required` for an unverified external server.
- `blocked` for restricted-risk tools.

The goal and raw model output are not written to logs. The Timeline stores only
provider/model metadata, token usage, duration, retry state, and calculated
cost.

See [docs/orchestrator.md](docs/orchestrator.md) for the detailed contract and
failure modes.

## MCP Tool Catalog

Signed-in users can manually sync metadata from:

```text
https://registry.modelcontextprotocol.io
```

The sync:

- Fetches up to 5 pages of 100 latest servers.
- Skips malformed or inactive records.
- Merges AgentDock-curated tools with official registry metadata.
- Preserves curated judgments when an external entry matches the same package
  or repository.
- Stores metadata only.

External registry entries are deny-by-default:

- Verification: `unverified`
- Risk: `medium`
- Recommended permission: `approval_required`
- Tool execution: disabled

The catalog API supports:

- Text search
- Category filter
- Risk filter
- Verification filter
- Registry-source filter
- Cursor pagination

## Governed MCP Client (any compliant server, through the gate)

AgentDock adopted MCP's data model from the start; it now has a real MCP
**execution** client too (`lib/execution/mcp-client.ts`, built on the official
`@modelcontextprotocol/sdk`). It speaks the real wire protocol — `initialize` →
`tools/list` → `tools/call` — so adding a capability becomes "connect a server +
grant + gate it," not "hand-write an executor per tool."

Every MCP `tools/call` routes through the **same deterministic policy gate** as
everything else: deny-by-default, action classification, the lethal-trifecta
guard, cost metering, approvals, the kill switch, and untrusted-output framing.
A newly discovered tool is **blocked until explicitly granted**. The agent emits
a structured `arguments` object matching the tool's input schema; the legacy
`search-mcp` string path is unchanged.

### First-party Gmail server

The first connected server is a first-party Gmail MCP server (`servers/gmail/`)
exposing two tools:

- `create_draft` — writes only to your own Drafts. Safe, reversible, no external
  side effect; executes without approval.
- `send_email` — a real outbound send. Classified as an external write, so it is
  **always approval-gated and never auto-sends** — there is no grant
  configuration under which a send is auto-allowed. Injected instructions buried
  in untrusted content cannot trigger a silent send; they still stop at approval.

The user's Google OAuth token (scopes `gmail.compose` + `gmail.send`) is stored
**encrypted** and read **server-side only** — it is injected into the Gmail
server's process environment and is never returned to a client or handed to an
agent. The founder performs the live Google consent once (see below).

Connecting **arbitrary third-party MCP servers is intentionally not enabled** —
only the allowlisted first-party server is connectable. Untrusted-server vetting
is a separate trust chunk.

### Enabling Gmail locally (founder step)

1. Add `gmail.compose` + `gmail.send` to the OAuth consent screen scopes in
   Google Cloud, then sign out and sign back in to re-consent.
2. Build a flow, grant a Gmail tool, and give the agent a goal that needs an
   email. `send_email` will pause at an approval card showing the exact
   to/subject/body; approving sends for real. `create_draft` lands a draft with
   no approval. The agent never receives your token.

## Flow Persistence and Run Preview

Saving a Flow persists:

- Name and goal
- Ordered agents and roles
- Weekly and per-run budgets
- Approval mode
- Attached tools
- Tool permission grants
- Memory attachments
- Serialized graph/layout metadata

**Flow truth (what you build is what runs).** Saving is fully reconciling, not
add-only: when a tool is removed from the authored flow, its `workflowMcp` row
**and** its `mcpAccessGrant` are deleted in the same transaction, so a removed
permission can never linger and be honored at runtime (deleting a stale grant is
stricter, never looser). Memory scoping is reconciled the same way — a partition
dropped from the flow is un-scoped. Reconciliation only runs for a payload that
explicitly carries the set: an omitted `tools`/`memory` key leaves existing rows
untouched (canvas saves attach tools through a separate endpoint), while an
explicit empty array reconciles to none. A `@@unique(userId, workflowId,
mcpServerId)` constraint on `McpAccessGrant` makes the grant write a single
deterministic `upsert`, so duplicates never accumulate and policy resolution is
unambiguous. Reopening a saved flow hydrates the canvas from the **persisted**
rows (agents, tools, grants, scoped memory) — never a stale layout blob — so the
executed set equals the stored set equals the authored set.

Run Preview lives in **Build** (run a preview of the flow you are authoring);
Control is reserved for real runs. Run Preview is generic: it walks the saved
agents in route order and evaluates each attached tool grant:

- No capability: `blocked`
- Approval gate: `approval_required`
- Otherwise: `allowed`

The preview creates:

- `WorkflowRun`
- `WorkflowRunEvent`
- `ApprovalRequest` when required
- `ActivityLog` entries

No agent, model, or tool is executed during Run Preview.

## Memory Firewall

Memory is partitioned into user-owned Memory Zones with:

- Flow or domain scope
- Sensitivity level
- Default access policy
- Memory items
- Per-agent/Flow grants
- Read, write, edit, delete, share, and approval flags
- Access history

Editing or revoking a memory grant writes both a memory-specific log and a
unified Timeline entry.

The nullable `vector(1536)` field is a future pgvector placeholder. AgentDock
does not generate embeddings yet.

## Workspace Bootstrap

After a user signs in, `BootstrapGate` calls the idempotent:

```text
POST /api/bootstrap
```

It creates missing starter agents, the Job Search Flow, Memory Zones, starter
memory items, and grants. Repeated calls do not duplicate the workspace.

Read routes such as `GET /api/workflows` and `GET /api/memory` are pure reads.

## API Overview

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | Auth.js session and Google login |
| POST | `/api/bootstrap` | Idempotent starter workspace |
| POST | `/api/flows/plan` | Real model-backed, policy-clamped Flow plan |
| GET/POST | `/api/workflows` | Load and save user Flows |
| GET | `/api/workflow-runs` | Recent persisted previews |
| POST | `/api/workflow-runs/simulate` | Generic metadata-only Run Preview (from Build) |
| GET/POST | `/api/runs` | List real runs (with flow name + output preview) / start a real run |
| GET | `/api/runs/[id]` | Real run detail: events with agent names + workflow name |
| GET | `/api/runs/[id]/stream` | SSE event stream — live run-event feed (cursor-based, additive to polling) |
| POST | `/api/runs/[id]/kill` | Kill an in-flight real run |
| POST | `/api/approvals/[id]/resolve` | Approve (resume after re-check), deny (halt), or edit (halt; re-run to apply) |
| GET | `/api/activity` | Unified Timeline |
| GET | `/api/memory` | Memory Zones, grants, items, and logs |
| PATCH | `/api/memory/grants/[id]` | Edit memory access |
| POST | `/api/memory/grants/[id]/revoke` | Revoke memory access |
| GET | `/api/mcp/servers` | Search/filter/paginate tool catalog |
| POST | `/api/mcp/sync-registry` | Sync official and curated MCP metadata |
| GET/POST | `/api/workflows/[workflowId]/mcps` | Load or attach Flow tools |
| PATCH | `/api/mcp/grants/[id]` | Edit tool access |
| POST | `/api/mcp/grants/[id]/revoke` | Revoke tool access |

All user-owned mutation routes require authentication and verify ownership.

## Database Model

The Prisma schema includes:

- Auth: `User`, `Account`, `Session`, `VerificationToken`
- Agents and Flows: `Agent`, `Workflow`, `WorkflowAgent`
- Runtime preview: `WorkflowRun`, `WorkflowRunEvent`
- Durable job queue: `RunJob`
- Approvals and audit: `ApprovalRequest`, `ActivityLog`
- Tools: `McpServer`, `McpTool`, `WorkflowMcp`, `McpAccessGrant`
- Memory: `MemoryPartition`, `MemoryItem`, `MemoryAccessGrant`,
  `MemoryAccessLog`
- Policy/access metadata: `PolicyProfile`, `ScopedCredential`

The UI uses the names **Flow** and **Tool**. Prisma currently retains
`Workflow` and `Mcp*` model names to avoid a high-churn migration.

Agents are user-scoped with a unique `(userId, name)` key. This prevents one
user's bootstrap or save operation from mutating another user's agents.

## Tests

Tests use a separate `agentdock_test` Postgres database. The global setup
refuses to run unless `DATABASE_URL` contains `agentdock_test`.

Create `.env.test`:

```bash
DATABASE_URL="postgresql://agentdock:agentdock@localhost:5432/agentdock_test?schema=public"
AUTH_SECRET="test-secret"
AUTH_URL="http://localhost:3000"
```

Create the database if needed:

```bash
createdb agentdock_test
```

The suite's global setup runs `prisma migrate deploy` automatically before the
tests. If it reports `P3009` (a prior failed migration in the target database),
recreate the test database from scratch, then re-run — migrations apply cleanly
on an empty database:

```bash
dropdb agentdock_test && createdb agentdock_test
```

Run:

```bash
npm test
```

> Point `.env.test` at a **local** Postgres database, not a remote one. The
> integration suite `TRUNCATE`s tables between tests and its cold, per-test
> dynamic `import()`s pay a TypeScript-transform cost — against a remote database
> the per-transaction round-trip pushes both past their timeouts and the suite
> goes red for purely environmental reasons. Locally the full suite is green in
> minutes.

The suite covers:

- Authentication and ownership requirements
- User isolation
- Bootstrap idempotence
- Pure GET behavior
- Generic Flow save and preview
- Zod API validation
- Approval resolution
- MCP registry normalization and sync
- Catalog search/filter/pagination
- Tool-grant safety
- Anthropic/OpenAI response parsing and cost calculation
- Orchestrator schema, reference resolution, permission clamping, retries,
  timeout, budget cap, oversize response handling, and prompt-injection posture
- Durable worker/queue: crash recovery, lease reclamation, step-cursor resume
- Idempotent external actions across retries (no double-fire)
- Async safety: kill mid-queue, caps from worker, revoke mid-run, per-user concurrency
- SSE event streaming via ReadableStream

Provider calls are mocked in tests; API keys are not required.

## Verification Commands

```bash
npx prisma validate
npx prisma generate
npm test
npm run build
```

## Security Boundaries

- `.env` and `.env.test` are gitignored.
- BYO provider keys are encrypted at rest in `ScopedCredential` and decrypted
  server-side only for real runs.
- Google OAuth token bundles for the optional first-party Gmail MCP path are
  encrypted at rest and injected only into the Gmail MCP server process env.
- Provider keys, Google tokens, and user goals are not logged or returned to the
  client. Run events store capped model/tool outputs for observability.
- Real secrets should eventually move from encrypted Postgres rows to Vault/KMS.
- External MCP registry entries never become trusted automatically.
- Tool attachment creates a permission grant but does not install arbitrary
  third-party servers. Only registered/allowlisted MCP servers can execute.
- Run Preview never executes agents or tools.

## Demo Flow

1. Sign in with Google.
2. Add a BYO Anthropic/OpenAI key in **Profile** if you want a real run.
3. Open **Build** and describe an outcome.
4. Click **Plan flow**.
5. Review provider, model, tokens, cost, duration, warnings, and the Flow Graph.
6. Tighten a tool permission if desired.
7. Save the Flow.
8. Open **Flows** to inspect the persisted graph and attached tools.
9. Run Preview from **Build** when you want a metadata-only rehearsal.
10. Open **Control** and click **Run for real** to execute saved agents with the
    BYO model key and governed tools.
11. Inspect Output vs Process, resolve approvals, or revoke tool/memory access.

Optional Gmail path: after adding Gmail OAuth scopes and re-consenting, attach a
registered Gmail tool. Draft creation can run as a reversible mailbox write;
send requests pause for approval and re-gate before sending.

## End Goal

AgentDock is intended to become the trusted governance and execution layer
between users, agents, models, tools, memory, credentials, and runtimes.

The future production loop is:

1. Describe an outcome.
2. Generate a policy-clamped Flow.
3. Review agents, tools, memory, approvals, runtime, and budget.
4. Issue temporary least-privilege access.
5. Execute through a controlled runtime and Tool Gateway.
6. Stream structured A2UI events in real time.
7. Pause, approve, deny, edit, or revoke any action.
8. Retain a complete audit and cost trail.

AgentDock is not intended to be another chatbot, agent marketplace, or raw GPU
cloud. It is the control plane that keeps users in control across agent
ecosystems.
