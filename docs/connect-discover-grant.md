# Connect, Discover, Grant — MCP Tool Reachability

## The three distinct steps

Connecting a tool to a flow has three deliberately separated steps:

1. **Connect** — Establish a connection to an MCP server. This verifies the
   server is reachable and (if needed) captures OAuth credentials through the
   credential broker. Connecting does NOT make any tools available.

2. **Discover** — Run `tools/list` against the connected server to discover its
   real advertised tools. Each tool is persisted with its name, description, and
   input schema. Discovery results are real — if the server changes, re-discover.

3. **Grant** — From the discovered tools, select specific ones to grant into a
   specific flow, setting each tool's permission level. Until granted, discovered
   tools are BLOCKED BY DEFAULT.

**Connecting ≠ granting ≠ permitting an action.** All three are deliberate,
human-initiated steps. A connected-and-granted external-write tool still goes
through the policy gate at run time — it is never auto-fired.

## Where credentials live

- OAuth tokens and provider keys are stored encrypted server-side in the
  `ScopedCredential` table.
- The credential broker (`lib/execution/credential-broker.ts`) maps a server's
  `authProvider` to the correct token loader.
- Tokens are injected into the MCP server's process environment ONLY — never
  passed to the agent, never appear in API responses, run events, or logs.
- The UI shows connection *status* (connected, error, etc.) but never secret
  material.

## The generic surface

Every screen, endpoint, and data path added in this chunk works for **any**
registered MCP server. No code branches on a specific server name. The server
registration in `lib/execution/mcp-client.ts` adds transport config; everything
else is generic.

To add a new connectable server:
1. Register it in `SERVER_REGISTRY` with transport config
2. If it needs auth, add a broker entry in `credential-broker.ts`
3. That's it — the connect/discover/grant surface works immediately

## The data model

```
ServerConnection (per-user lifecycle)
  ├── userId + serverKey (unique per user)
  ├── status: registered → connecting → connected → discovered → error/disconnected
  ├── authProvider: broker key (never the secret)
  └── lastDiscoveredAt, lastError

McpServer (catalog + discovered tools)
  ├── mcpServerKey: the registered server (e.g. "gmail")
  ├── mcpToolName: the discovered tool (e.g. "send_email")
  ├── credentialProvider: broker key
  └── isExternalSend: action classification

McpAccessGrant (permission)
  ├── userId + workflowId + mcpServerId
  ├── canRead, canWrite, canExecute, canDelete
  └── requiresApproval, revokedAt
```

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET    | /api/mcp/connections | List user's connections |
| POST   | /api/mcp/connections | Connect to a server |
| DELETE | /api/mcp/connections/:id | Disconnect, revoke grants |
| POST   | /api/mcp/connections/:id/discover | Run tools/list, persist tools |
| GET    | /api/mcp/connections/:id/tools | List discovered tools |
| POST   | /api/workflows/:id/mcps | Grant tool to flow (existing) |
| DELETE | /api/workflows/:id/mcps/:mcpId | Remove tool grant |

## Security invariants

1. **Deny-by-default survives the new surface.** A connected, discovered but
   un-granted tool is blocked at run time.
2. **Connect doesn't bypass the gate.** A granted external-write tool still
   forces approval at run time.
3. **Credentials never reach the agent or client.** OAuth tokens flow through
   the broker, stored encrypted server-side.
4. **Discovery is real.** Tool lists come from live `tools/list` — never
   synthesized.
5. **Ownership is enforced.** A user cannot connect, discover, or grant against
   another user's server or credential.
6. **No secrets in responses or logs.** Tokens never appear in connection
   status, discovery output, grant data, run events, or logs.
7. **Granted identity === executed identity.** The tool the UI grants is the
   exact same tool the worker executes (same `mcpServerKey` + `mcpToolName`).
