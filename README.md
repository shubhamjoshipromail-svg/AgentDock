# AgentDock

AgentDock is a prototype control plane for building, governing, previewing, and
monitoring multi-agent Flows across model providers and MCP tools.

The product is deliberately split into two modes:

- **Build:** describe an outcome, generate or load a Flow, inspect its agents,
  tools, memory, approvals, and budget, then save it.
- **Control:** preview a saved Flow, resolve approvals, inspect policy decisions,
  monitor spend, and review the unified Timeline.

AgentDock has a real identity and policy-data plane. It can persist users,
Flows, agents, tool grants, memory grants, model-planning costs, preview runs,
approvals, and activity. It also has an early real-run path: a signed-in user can
store an encrypted BYO Anthropic/OpenAI key, run saved Flow agents through real
model calls, and use one real read-only tool (`search-mcp`). All other tools
remain metadata/gated/unavailable until an executor exists.

## Current Product Surface

The main navigation is:

- **Build** — model-backed Flow planning, templates, editable permissions,
  graph visualization, save, and run preview.
- **Store** — agents, the official MCP registry catalog, curated tools, search,
  filters, pagination, and Flow attachment.
- **Flows** — saved Flows, their agents, attached tools, graph detail, and
  scoped-access controls.
- **Control** — A2UI-style event cards, approval inbox, run history, policy
  blocks, and spend.
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
- MCP revocation with `revokedAt` kill-switch semantics.
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
- MCP server installation.
- MCP tool invocation beyond the built-in read-only Search MCP executor.
- Gmail, Calendar, Drive, GitHub, or Stripe account connections.
- Gmail, Calendar, Drive, GitHub, Stripe, or other write-capable tool execution.
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
Database-backed Run Preview
        |
        +--> WorkflowRunEvent
        +--> ApprovalRequest
        +--> ActivityLog / Timeline
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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Use `localhost` consistently for the browser, `AUTH_URL`, Google authorized
origin, and Google callback. Mixing `localhost` and `127.0.0.1` can break OAuth
cookies and callback validation.

## Google OAuth

AgentDock requests identity scopes only:

```text
openid email profile
```

In Google Cloud, configure:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI:
  `http://localhost:3000/api/auth/callback/google`

AgentDock does not request Gmail, Calendar, Drive, or other Workspace scopes.

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

Run Preview is generic. It walks the saved agents in route order and evaluates
each attached tool grant:

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
| POST | `/api/workflow-runs/simulate` | Generic metadata-only Run Preview |
| POST | `/api/approvals/[id]/resolve` | Approve, deny, or edit a request |
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

Run:

```bash
npm test
```

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
- Provider keys are read server-side only.
- Provider keys, raw model output, and user goals are not logged.
- No provider or MCP credentials are stored in `ScopedCredential`; it is
  metadata-only.
- Real secrets should eventually live in Vault/KMS.
- External MCP registry entries never become trusted automatically.
- Tool attachment creates a permission grant but does not install or execute
  the tool.
- Run Preview never executes agents or tools.

## Demo Flow

1. Sign in with Google.
2. Open **Build** and describe an outcome.
3. Click **Plan flow**.
4. Review provider, model, tokens, cost, duration, warnings, and the Flow Graph.
5. Tighten a tool permission if desired.
6. Save the Flow.
7. Open **Flows** to inspect the persisted graph and attached tools.
8. Run Preview.
9. Open **Control** to inspect Timeline events and pending approvals.
10. Resolve an approval or revoke tool/memory access.

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
