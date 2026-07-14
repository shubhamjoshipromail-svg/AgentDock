# Deploying AgentDock

AgentDock is **two long-lived processes** sharing one Postgres database and one
container image:

| Process | Command | Role |
|---|---|---|
| **web** | `npm run start` | Next.js server — UI + API on port 3000 |
| **worker** | `npm run worker` | Claims run jobs and executes flows (real model + tool calls) |

**Without the worker, flows queue forever and nothing runs.** Deploy both.

The image (`Dockerfile`) builds the Next app and pre-compiles the first-party MCP
servers (`servers/gmail/dist`, `servers/search/dist`), which the worker spawns as
child processes. Both processes run from the same image; only the command differs.

---

## 0. Prerequisites

- A container host that can run **two services** and keep the worker **supervised**
  (auto-restart on crash): Railway, Render, Fly.io, Docker on a VM, etc.
- A **managed Postgres** (Railway/Render/Neon/RDS…). Do **not** use the repo's
  dev-only embedded Postgres (`.pgbin`/`.pgdata`) in production.
- A **Google Cloud** project for OAuth + Gmail.
- One **model provider key** for the planner (Anthropic / OpenAI / OpenRouter).

---

## 1. Provision Postgres

Create a managed Postgres instance and copy its connection string. This is your
`DATABASE_URL` (append `?schema=public` if the platform doesn't).

## 2. Configure environment variables

Set these on **both** the web and worker services (see `.env.example` for the
full annotated list):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Managed Postgres connection string |
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `AUTH_URL` | ✅ | Public HTTPS origin, e.g. `https://agentdock.example.com` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | From step 5 |
| `CREDENTIAL_ENCRYPTION_KEY` | ✅ | `openssl rand -base64 32`; encrypts stored keys/tokens at rest |
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `OPENROUTER_API_KEY`) | ✅ | Planner key |
| `ANTHROPIC_MODEL` etc. | ⬜ | Optional model override |
| `RUN_MAX_COST_CENTS`, `USER_DAILY_RUN_COST_CAP_CENTS`, … | ⬜ | Spend caps (safe defaults in code) |

> Users bring their **own** provider key for *runs* (Profile → Provider keys). The
> `ANTHROPIC_API_KEY` above is the system **planner** key only. Keep them distinct.

## 3. Run database migrations

Run once per deploy, before/at release, against the production `DATABASE_URL`:

```bash
npx prisma migrate deploy
```

On most PaaS platforms this is a **release command** / pre-deploy hook. In the
bundled `docker-compose.yml` it is the one-shot `migrate` service that `web` and
`worker` wait on.

## 4. Deploy the two services

Both use the same image; set the start command per service:

- **web** → `npm run start`, expose port **3000**, attach a health check to
  `GET /api/health` (see §6).
- **worker** → `npm run worker`, **no** public port, **restart on failure**.

### Platform notes
- **Railway / Render:** create **two services** from this repo/image. One web
  (port 3000, health check `/api/health`), one **background worker**
  (`npm run worker`, no port). Add `npx prisma migrate deploy` as the release
  command. Set the env vars on both.
- **Fly.io:** two process groups in `fly.toml` (`app = "npm run start"`,
  `worker = "npm run worker"`); `release_command = "npx prisma migrate deploy"`.
  Give the worker a restart policy.
- **Single VM:** `docker compose up -d --build` (bundled compose runs migrate +
  web + worker with `restart: unless-stopped`). Front it with TLS (Caddy/nginx).

## 5. Google OAuth + Gmail

In Google Cloud Console:

1. **Enable the Gmail API** for the project (APIs & Services → Library → Gmail API).
2. **OAuth consent screen:** while in **Testing** mode, add each alpha user's
   Google address under **Test users** (only they can sign in). Scopes requested:
   `openid email profile gmail.compose gmail.send`.
3. **Credentials → OAuth client ID (Web application):** set the **Authorized
   redirect URI** to `${AUTH_URL}/api/auth/callback/google` (exactly matching
   your deployed origin). Copy the client id/secret into the env vars.

## 6. Verify the deploy

1. **Health:** `curl https://<your-host>/api/health` → `200` with
   `{ "ok": true, "db": { "ok": true }, "worker": { "ok": true, "lastSeenAt": … } }`.
   - `db.ok: false` → the web app can't reach Postgres (`503`).
   - `worker.ok: false` or `lastSeenAt: null` → the **worker isn't running**; flows
     will queue and never execute. Check the worker service is up and supervised.
2. **End-to-end:** sign in with a Test User → set a provider key → describe a goal
   → run → approve the draft → confirm the deliverable and the audit trail. This
   is the release-gate journey (see `FOUNDER_LAUNCH_CHECKLIST`).

---

## Operations

- **Worker liveness:** `GET /api/health` reports `worker.lastSeenAt` and
  `staleSeconds` (heartbeat older than 90s ⇒ `worker.ok: false`). Point an uptime
  monitor at `/api/health` and alert on `db.ok` **and** `worker.ok`.
- **Supervision:** the worker must auto-restart. It drains the current job on
  `SIGTERM`/`SIGINT`; expired leases are reclaimed by the next worker, and external
  sends are idempotent, so a crash mid-run is recovered without double-firing.
- **Scaling:** more than one worker is safe (jobs are claimed with
  `FOR UPDATE SKIP LOCKED`, bounded per-user concurrency).
- **Secrets:** `CREDENTIAL_ENCRYPTION_KEY` must be stable — rotating it
  invalidates all stored encrypted provider keys and Google tokens.
