# Generic Tool Integration — Register, Connect, Grant (Chunk 15)

Integrating a new MCP server requires **no execution code**. A new tool is a
**registration record + an OAuth provider in the broker (reused where possible) +
connect + discover + grant** — not a coding project. This document describes the
three pillars that make that true.

## 1. Server registration is DATA, not a code constant

How to launch/reach an MCP server lives in the **`ServerRegistration`** table
(`prisma/schema.prisma`), resolved by `resolveRegistration()` in
`lib/execution/mcp-client.ts`. A registration holds, as data:

- `serverKey`, `displayName`
- `transport` — `stdio` (a vetted local `command` + `args`) **or** `http`/`sse`
  (a remote MCP `url`)
- `credentialProvider` (which broker entry, nullable) and `tokenEnvVar` (nullable)
- `enabled` / `curated` flags

`isConnectableMcpServer`, `mcpTokenEnvVar`, `serverDisplayLabel`,
`serverAuthProvider`, and the transport factory all read from this data — there is
**no hardcoded allowlist** and no per-server label/auth maps. Adding a row makes a
server connectable through the existing generic connect/discover/grant flow with
zero code change.

First-party entries (`gmail`, `search`) are mirrored in a curated data module
(`lib/registry/server-registrations.ts`) and seeded as rows. The module is the
bootstrap/fallback so a fresh (or truncated test) database still reaches the
first-party servers; the DB row is authoritative and overrides it.

### Security boundary — registrations are curated, NOT user-submitted

A `command` is a local process AgentDock spawns. Letting an arbitrary user
register an arbitrary stdio command would be **remote code execution.** Therefore:

- Registrations are **seed/admin-curated only.** There is no API route that
  creates a `ServerRegistration` row (enforced by a red-team test).
- The connect endpoint accepts **only a `serverKey`** naming an already-registered
  server; any injected `command`/`args` in the request body is stripped by the
  schema, never honored.
- Remote-URL (`http`/`sse`) servers are the safer general path for future
  third-party servers. **Arbitrary third-party server registration + vetting is
  intentionally still closed** — it is its own later trust chunk.

## 2. The generic, scoped credential broker

`lib/execution/credential-broker.ts` is the **single path a credential reaches a
server.** A server's `credentialProvider` selects a provider loader from a
registry where `google` is one of N (not a special case);
`registerCredentialProvider()` adds a provider with no execution-path change.

- **Server-side only.** The broker loads/decrypts and the run engine injects the
  token into the MCP server's **process env only** — it never returns to the
  client, the agent context, run events, or logs.
- **Short-lived / refreshed.** Tokens are refreshed server-side before expiry
  (e.g. Gmail's OAuth refresh token).
- **Scope/limit enforcement point.** Before issuing a credential for a
  consequential (external-write) action, `brokerCredentialForAction()` refuses
  unless an active, unexpired, in-limit, in-scope grant authorizes it (the mandate
  shape mirrors `McpAccessGrant`). Full **signed mandates** (money-grade) are the
  next layer — this chunk wires the enforcement *point*.

## 3. ONE execution path

Every tool — web search and Gmail alike — executes through the single
`callMcpTool` path in `executeAllowedTool` (`lib/execution/run-engine.ts`). There
is **no second registry, no `getExecutor`, and no `if (serverName === "search-mcp")`**.
Web search is a real first-party MCP server (`servers/search/`), reached
identically to any other server. The deterministic gate, idempotency guard,
untrusted-output framing, cost metering, and immutable audit wrap that **one**
path unchanged.

A tool is executable iff it carries MCP identity (`mcpServerKey` + `mcpToolName`);
anything else is recorded as `[unavailable]` — never a fabricated success.

## What adding the next tool looks like

For a hosted Stripe/GitHub/Notion MCP server:

1. **Register** — add a curated/seeded `ServerRegistration` row (remote `url`, or a
   vetted local command).
2. **Broker** — if it needs auth, add (or reuse) a provider entry in the broker.
3. **Connect → Discover → Grant** — through the existing generic endpoints.

No execution code changes. Gmail is the proof: it is registered (data), its OAuth
is handled by the generic broker, and it executes via the single path with **zero
Gmail-specific execution code** — and a second credentialed server runs the
identical path (see `tests/gmail-generic.test.ts`).

## Out of scope (intentionally)

- Arbitrary third-party MCP server registration + vetting/trust (open "register
  any URL") — a separate trust chunk.
- Full signed mandates (money-grade scoped authorization) → Stripe/transactions —
  the broker wires the enforcement point here; the mandate protocol + money come
  next.
