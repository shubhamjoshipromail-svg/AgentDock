# AgentDock

Investor-demo prototype for the cross-platform control plane for AI agents.

## Local App

```bash
npm install
npm run dev -- --hostname 127.0.0.1
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Postgres Foundation

AgentDock uses Postgres as the planned system of record for workflows, agents, scoped credentials, and the Memory & Context layer. The UI remains prototype-friendly and falls back to mock data if no database is connected.

Start local Postgres with pgvector:

```bash
cp .env.example .env
docker compose up -d
npx prisma migrate dev
npx prisma db seed
```

Generate Prisma Client after schema changes:

```bash
npm run db:generate
```

## Google Login

AgentDock uses Google only for identity in this prototype. It does not request Gmail, Calendar, Drive, or Workspace scopes.

1. Create a Google OAuth client in Google Cloud Console.
2. Set Authorized JavaScript origin to `http://localhost:3000`.
3. Set Authorized redirect URI to `http://localhost:3000/api/auth/callback/google`.
4. Add these values to `.env`:

```bash
AUTH_URL="http://localhost:3000"
AUTH_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Generate `AUTH_SECRET` with one of:

```bash
npx auth secret
openssl rand -base64 32
```

Apply the database schema and run the app:

```bash
docker compose up -d
npx prisma migrate dev
npx prisma generate
npm run dev
```

Use the same host everywhere during OAuth. For this prototype, use `localhost`: open `http://localhost:3000`, set `AUTH_URL` to `http://localhost:3000`, and register `http://localhost:3000/api/auth/callback/google` in Google Cloud. Mixing `localhost` and `127.0.0.1` causes OAuth callback/cookie errors.

## Saving workflows

Saved workflows are the first user-specific persistence feature. To test it locally:

1. Run Postgres with `docker compose up -d`.
2. Run `npx prisma migrate dev` so the workflow and Auth.js tables exist.
3. Sign in with Google.
4. Open Builder or Workflows and click `Save workflow`.
5. AgentDock stores the Job Search Automation workflow in Postgres for the signed-in user.

Signed-out users can still explore the mock demo, but saving requires Google sign-in.

## Database-backed workflow simulation

Workflow simulation is mock execution with real persistence. AgentDock does not call agents, MCP servers, Gmail scopes, or model APIs. A signed-in simulation writes runtime records to Postgres:

- `workflow_runs`
- `workflow_run_events`
- `approval_requests`
- `activity_logs`

To test:

1. Sign in with Google.
2. Save `Job Search Automation` if it is not already saved.
3. Click `Simulate run` in Builder or `Run` in Workflows.
4. Open Activity to see DB-backed activity logs.
5. Resolve pending approvals in the Builder approval inbox.
6. Refresh the page and confirm runs, approvals, and activity remain available.

Apply the runtime tables with:

```bash
npx prisma migrate deploy
```

## MCP Store Phase 1

The MCP Store is metadata-only in this phase. AgentDock does not install MCP packages, execute MCP servers, call MCP tools, request Google Workspace scopes, or store real secrets.

To test:

1. Sign in with Google.
2. Open Store → `MCPs / Tools`.
3. Click `Sync MCP Registry`.
4. AgentDock imports the curated safe fallback MCP catalog into Postgres.
5. Click `Add to workflow` on `Search MCP` or `Gmail Draft MCP`.
6. Open Workflows to see attached MCP metadata and generated permission templates.
7. Open Activity to see sync and attach audit events.

## Security Notes

- This prototype stores only scoped credential metadata.
- Do not store real provider keys, OAuth tokens, MCP credentials, or agent secrets in Postgres.
- Real secrets should live in a secure vault/KMS, with only references and policy metadata stored in the database.
- Embeddings are not implemented. The schema includes an optional pgvector column as a future-ready placeholder.

## The control-tower UI

AgentDock's interface is a dark "control tower" operations room: high-signal,
telemetry-rich, monospace for every machine-true value (costs, tokens, timestamps,
IDs, event types). Risk and decision colors are consistent everywhere — color is
meaning. The signature surface is the **Flow Graph** (goal → agent spine → tools/
memory/approval gates) and the **A2UI feed** in Control, where every agent event
reaches you through one card grammar: who · what · on what · authority · decision · cost.

### Screenshots

_Add screenshots here:_
- `docs/screenshots/build-graph.png` — Build: goal → plan meta → warnings strip → flow graph
- `docs/screenshots/control-a2ui.png` — Control: A2UI timeline + approval inbox + spend panel
- `docs/screenshots/flows.png` — Flows: flow-card grid + read-only graph detail
- `docs/screenshots/store.png` — Store: tool catalog with risk/verification badges

### 90-second demo script

1. **Build** — type a goal (or click an example chip). Click **Generate Flow**.
2. The **plan meta** line (provider · model · tokens · cost · duration) appears under the goal in mono.
3. A **warnings strip** ("N permissions adjusted by policy") and the **flow graph** render.
4. Tighten one tool's permission select (you can only go stricter than the policy ceiling).
5. Click **Save Flow**.
6. Open **Flows** — the saved flow shows in the card grid; its detail renders the same graph read-only.
7. **Run preview** — a supervised run executes (simulated).
8. Open **Control** — events stream in as A2UI grammar cards, color-coded by decision.
9. One **approval** is pending in the inbox. Click **Approve** — it resolves and re-files.
10. The **spend panel** shows the real cost in mono against the weekly cap.
11. In Flows → My Tools (or Profile → Memory), **Revoke access** with an inline confirm.

Runs scroll-free at 1440×900.
