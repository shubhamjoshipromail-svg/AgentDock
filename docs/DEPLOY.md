# Deploy AgentDock on Railway

AgentDock needs three Railway services in one project:

| Railway service | Source | Config file | Public? | Purpose |
|---|---|---|---|---|
| `Postgres` | Railway PostgreSQL | managed by Railway | no | Shared durable database |
| `web` | this GitHub repository | `/railway.web.json` | yes | Next.js UI and API |
| `worker` | this GitHub repository | `/railway.worker.json` | no | Claims and executes run jobs |

The two application services build the same root `Dockerfile`. That image builds
Next.js plus the first-party Gmail and Search MCP servers. The config files give
each service its own start command, run `prisma migrate deploy` before release,
and keep the processes supervised. The web service also binds to Railway's
injected `PORT` through `next start` and checks `/api/health` before it receives
traffic.

Without `worker`, runs remain queued. Do not combine the two processes for the
production alpha.

## Current alpha deployment

As of 2026-07-15, the `AgentDock` Railway project's `production` environment is
deployed from branch `codex/chunk21-final-pass`:

- Public web URL: `https://web-production-e123b.up.railway.app`
- Google callback to register: `https://web-production-e123b.up.railway.app/api/auth/callback/google`
- `web`, `worker`, and Railway `Postgres`: running in EU West
- Infrastructure smoke: `/` returned HTTP 200 and `/api/health` returned
  `db.ok: true` plus `worker.ok: true`

Fresh `NEXTAUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` values are already set in
Railway and were not printed or committed. Google OAuth/client variables and a
planner key are intentionally still unset, so the hosted sign-in and end-to-end
Gmail smoke remain pending the steps below.

## 1. Prerequisites

Have these ready before opening Railway:

- the branch to deploy pushed to GitHub;
- a Railway account and project plan;
- a Google Cloud project where you can configure OAuth and enable Gmail;
- one system planner key: Anthropic, OpenAI, or OpenRouter;
- the founder and alpha-user Gmail addresses.

Generate two different production secrets locally. Do not reuse development
values and do not commit the output:

```bash
openssl rand -base64 32 # NEXTAUTH_SECRET
openssl rand -base64 32 # CREDENTIAL_ENCRYPTION_KEY
```

The encryption key must remain stable. Changing it makes stored provider keys and
Google tokens unreadable.

## 2. Create the Railway project and Postgres

1. In Railway, click **New Project** → **Empty Project**.
2. On the project canvas, click **+ New** → **Database** → **Add PostgreSQL**.
3. Keep the database service name `Postgres`. If you rename it, replace
   `Postgres` in every `${{Postgres.DATABASE_URL}}` reference below.
4. For a production alpha, enable Railway backups for the Postgres service.

Railway supplies the database's `DATABASE_URL`; do not paste an externally
exposed Postgres URL into the app services.

## 3. Add the web service

1. On the project canvas, click **+ New** → **GitHub Repo** and select this repo.
2. Rename the service `web`.
3. Open `web` → **Settings** and set **Config File Path** to
   `/railway.web.json`.
4. Confirm the deployment details resolve to:
   - Dockerfile: `Dockerfile`
   - pre-deploy: `npx prisma migrate deploy`
   - start: `npm run start`
   - healthcheck: `/api/health`
   - restart policy: always
5. Under **Settings** → **Networking**, click **Generate Domain**. Keep the exact
   `https://...up.railway.app` origin for the Google step.

Do not set a fixed `PORT`. Railway injects it, and `next start` listens on it.

## 4. Add the worker service

1. Click **+ New** → **GitHub Repo** again and select the same repo and branch.
2. Rename this service `worker`.
3. Open `worker` → **Settings** and set **Config File Path** to
   `/railway.worker.json`.
4. Confirm the deployment details resolve to:
   - Dockerfile: `Dockerfile`
   - pre-deploy: `npx prisma migrate deploy`
   - start: `npm run worker`
   - restart policy: always
5. Do **not** generate a domain for the worker. It is a background process.

Both services may run the migration command during the same release. Prisma's
production migration command is repeatable; after the first service applies a
migration, the other sees no pending work.

## 5. Add production variables

Open each service's **Variables** tab and use **Raw Editor**. Replace every
`<...>` value. Railway reference expressions must be pasted literally.

### `web` variables

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
NEXTAUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
NEXTAUTH_SECRET=<fresh-nextauth-secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
CREDENTIAL_ENCRYPTION_KEY=<fresh-encryption-key>
ANTHROPIC_API_KEY=<planner-key>
FOUNDER_EMAILS=<comma-separated-founder-emails>
RUN_MAX_COST_CENTS=50
USER_DAILY_RUN_COST_CAP_CENTS=200
ORCHESTRATOR_MAX_COST_CENTS_PER_CALL=10
ORCHESTRATOR_DAILY_USER_COST_CAP_CENTS=100
```

Use `OPENAI_API_KEY` or `OPENROUTER_API_KEY` instead of `ANTHROPIC_API_KEY` if
that is the planner provider. `ORCHESTRATOR_PROVIDER` and model overrides are
optional; `.env.example` is the complete reference.

### `worker` variables

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
GOOGLE_CLIENT_ID=<same-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<same-google-oauth-client-secret>
CREDENTIAL_ENCRYPTION_KEY=<same-encryption-key-as-web>
RUN_MAX_COST_CENTS=50
USER_DAILY_RUN_COST_CAP_CENTS=200
RUN_MAX_STEPS=16
RUN_MAX_TOOL_CALLS=8
WORKER_POLL_MS=2000
WORKER_LEASE_MS=60000
WORKER_PER_USER_CONCURRENCY=1
```

The Google client secret and encryption key must match across `web` and
`worker`: web stores OAuth tokens and worker decrypts and refreshes them. Seal
secret variables in Railway after saving them.

Users add their own run-provider key in **Profile**. The system planner key on
`web` is only for planning a new flow.

## 6. Configure Google OAuth and Gmail

In Google Cloud Console:

1. Open **APIs & Services** → **Library**, find **Gmail API**, and enable it.
2. Open **Google Auth Platform** / **OAuth consent screen**. While the app is in
   Testing, add every founder and alpha Gmail address under **Test users**.
3. Open **APIs & Services** → **Credentials** → the Web application OAuth client.
4. Add this exact authorized redirect URI, substituting the generated web domain:

   ```text
   https://<railway-domain>/api/auth/callback/google
   ```

5. Save, then make sure that client's id and secret match the Railway variables
   on both services.

The application requests `openid`, `email`, `profile`, `gmail.compose`, and
`gmail.send`. Sending remains opt-in and every real send remains approval-gated.

## 7. Deploy

1. Review Railway's staged changes and click **Deploy**.
2. In `web` deployment logs, confirm the Dockerfile builds Next.js plus
   `build:gmail` and `build:search`, then `prisma migrate deploy` succeeds.
3. In `worker` logs, confirm a line beginning `[worker] ... starting` appears and
   the service remains running.
4. If variables changed after the first deployment, redeploy both services.

## 8. Production smoke checklist

First, query the public web domain:

```bash
curl -fsS https://<railway-domain>/api/health
```

The response must be HTTP 200 and contain both of these truths (timestamps and
durations vary):

```json
{"ok":true,"db":{"ok":true},"worker":{"ok":true,"lastSeenAt":"..."}}
```

HTTP 200 alone is not enough: the health route keeps the web service available
when the independent worker is down. For release, inspect `worker.ok` and require
it to be `true`.

Then perform the hosted investor path:

1. Open the hosted URL in a private window and sign in as an OAuth test user.
2. Confirm the fresh account has exactly these flows:
   - `Research & email me a summary`
   - `Research → you choose → email your picks`
   - `Brief → draft`
3. In **Profile**, save a run-provider key.
4. Run `Research → you choose → email your picks`.
5. Enter a topic, wait for real Search results, choose two options in the choice
   surface, and continue.
6. Confirm the email approval card shows the exact action. Approve it.
7. Confirm the Gmail draft lands, the deliverable is clean, and Activity shows
   the governed audit trail.
8. Open `/api/admin/funnel` while signed in as an address listed in
   `FOUNDER_EMAILS`; confirm the session ends in an activation event.

Draft-only remains the default. To test a real send, explicitly enable **Real
sending** in Profile; `send_email` still pauses for approval.

## 9. Founder investor-readiness checks

Before sharing the URL, perform all five on the hosted deployment:

1. A fresh account signs in and sees exactly the three vetted flows.
2. The choice flow completes end-to-end in roughly 60 seconds with a real draft
   or approved send and a clean audit trail.
3. Rapidly double-click and spam the one visible Run button; exactly one run is
   created.
4. Run with a missing topic; a form asks for it and no internal reasoning appears
   as a completed result.
5. `/api/admin/funnel` records the activation journey.

## Troubleshooting

- `db.ok: false` or HTTP 503: verify `DATABASE_URL` is exactly
  `${{Postgres.DATABASE_URL}}` on that service and inspect the migration logs.
- `worker.ok: false`: the worker is missing, crashed, using a different database,
  or has not heartbeated within 90 seconds. Inspect `worker` logs and variables.
- Google `redirect_uri_mismatch`: compare the full HTTPS callback character for
  character; do not omit `/api/auth/callback/google`.
- Runs fail to refresh Gmail access: verify both services share the same Google
  client values and `CREDENTIAL_ENCRYPTION_KEY`.
- A run queues forever: the worker is not healthy even if the web endpoint still
  returns HTTP 200.

Railway's deployment healthcheck is a release-time readiness check, not ongoing
monitoring. Add an external uptime check for `/api/health` and alert when either
`db.ok` or `worker.ok` is false.
