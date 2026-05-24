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

## Saving workflows

Saved workflows are the first user-specific persistence feature. To test it locally:

1. Run Postgres with `docker compose up -d`.
2. Run `npx prisma migrate dev` so the workflow and Auth.js tables exist.
3. Sign in with Google.
4. Open Builder or Workflows and click `Save workflow`.
5. AgentDock stores the Job Search Automation workflow in Postgres for the signed-in user.

Signed-out users can still explore the mock demo, but saving requires Google sign-in.

## Security Notes

- This prototype stores only scoped credential metadata.
- Do not store real provider keys, OAuth tokens, MCP credentials, or agent secrets in Postgres.
- Real secrets should live in a secure vault/KMS, with only references and policy metadata stored in the database.
- Embeddings are not implemented. The schema includes an optional pgvector column as a future-ready placeholder.
