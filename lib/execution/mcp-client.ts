import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { prisma } from "../prisma";
import { findCuratedRegistration, type CuratedTransport } from "../registry/server-registrations";

// A real, governed MCP client. It speaks the actual wire protocol (initialize →
// tools/list → tools/call) via the official SDK — no hand-rolled JSON-RPC. It
// performs NO policy decisions: discovery and invocation only. The caller
// (run-engine, via the deterministic gate) decides what may run. This is the
// single execution path every compliant MCP server's tools flow through.

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  text: string;
  isError: boolean;
};

export type McpConnectContext = {
  // Per-user connection scoping. The first-party server reads the user's
  // credentials server-side (via env / lookup); the token never transits here.
  userId?: string;
  env?: Record<string, string>;
};

// A registered MCP server: how to launch/reach it (transport) and which env var
// its credential broker fills. This is server *registration* — config DATA in the
// `ServerRegistration` table (curated/seeded), not per-server control flow.
// Connectability is "is this server registered + enabled", resolved from data —
// not a hardcoded allowlist of names. Adding a server is a new row; no execution
// code changes.
export type ResolvedRegistration = {
  serverKey: string;
  displayName: string;
  transport: CuratedTransport;
  command: string | null;
  args: string[];
  url: string | null;
  credentialProvider: string | null;
  tokenEnvVar: string | null;
  // The host env keys this server may receive. Deny-by-default (empty = none).
  envAllowlist: string[];
};

// ============================================================================
// THE ISOLATION FLOOR — what a spawned MCP server is allowed to see.
//
// An MCP server is untrusted by construction: it is a separate process, it may be
// third-party, and it can read its own environment. It therefore receives ONLY:
//   1. a minimal safe base (PATH/HOME/…, from the SDK's sudo-inspired default),
//   2. the host env keys its registration explicitly declares, and
//   3. the brokered credential the run engine injects for this specific call.
//
// It must NEVER receive the host environment wholesale. CREDENTIAL_ENCRYPTION_KEY
// and DATABASE_URL together are enough to decrypt every user's stored OAuth tokens
// and BYO provider keys, so leaking them to a tool process is a total compromise.
//
// This is a floor, not a sandbox: it bounds what a server can READ from its env.
// Process/filesystem/network/resource isolation is still required before any
// THIRD-PARTY server runs (see docs/FULL_REVIEW.md Track 6).
//
// Proved end-to-end against a real spawned child in tests/mcp-env-isolation.test.ts.
// ============================================================================
export function buildChildEnv(
  envAllowlist: readonly string[],
  brokered: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const key of envAllowlist) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // The brokered credential is injected last: it is issued per-call for this
  // server and must not be shadowed by a host value of the same name.
  return { ...env, ...brokered };
}

// Resolve a server's registration: the DB table is authoritative; first-party
// curated data is the bootstrap/fallback so a fresh (or truncated test) database
// still reaches first-party servers without seeding. Disabled rows are not
// connectable. NO server-name branching — every server flows through this lookup.
export async function resolveRegistration(serverKey: string): Promise<ResolvedRegistration | null> {
  const row = await prisma.serverRegistration.findUnique({ where: { serverKey } }).catch(() => null);
  if (row) {
    if (!row.enabled) return null;
    return {
      serverKey: row.serverKey,
      displayName: row.displayName,
      transport: row.transport as CuratedTransport,
      command: row.command,
      args: Array.isArray(row.args) ? (row.args as string[]) : [],
      url: row.url,
      credentialProvider: row.credentialProvider,
      tokenEnvVar: row.tokenEnvVar,
      envAllowlist: Array.isArray(row.envAllowlist) ? row.envAllowlist : []
    };
  }
  const curated = findCuratedRegistration(serverKey);
  if (!curated) return null;
  return {
    serverKey: curated.serverKey,
    displayName: curated.displayName,
    transport: curated.transport,
    command: curated.command ?? null,
    args: curated.args ?? [],
    url: curated.url ?? null,
    credentialProvider: curated.credentialProvider ?? null,
    tokenEnvVar: curated.tokenEnvVar ?? null,
    envAllowlist: curated.envAllowlist ?? []
  };
}

export async function isConnectableMcpServer(serverKey: string): Promise<boolean> {
  return (await resolveRegistration(serverKey)) !== null;
}

// The env var name a registered server expects its brokered credential in (if any).
export async function mcpTokenEnvVar(serverKey: string): Promise<string | null> {
  return (await resolveRegistration(serverKey))?.tokenEnvVar ?? null;
}

// Display label for a registered server (data-driven — replaces the duplicated
// hardcoded { gmail: "Gmail" } label maps in the connection routes).
export async function serverDisplayLabel(serverKey: string): Promise<string> {
  return (await resolveRegistration(serverKey))?.displayName ?? serverKey;
}

// The credential-broker provider a registered server authenticates with (if any).
export async function serverAuthProvider(serverKey: string): Promise<string | null> {
  return (await resolveRegistration(serverKey))?.credentialProvider ?? null;
}

export type TransportFactory = (serverKey: string, ctx?: McpConnectContext) => Transport | Promise<Transport>;

// The real transport reaches the registered server per its registration: a vetted
// local process over stdio, or a remote http/sse endpoint by URL. Tests inject an
// in-memory transport instead (no child process), exercising the same client path.
async function defaultTransport(serverKey: string, ctx?: McpConnectContext): Promise<Transport> {
  const registration = await resolveRegistration(serverKey);
  if (!registration) {
    throw new Error(`MCP server '${serverKey}' is not registered.`);
  }
  if (registration.transport === "http" || registration.transport === "sse") {
    if (!registration.url) {
      throw new Error(`MCP server '${serverKey}' has transport '${registration.transport}' but no url.`);
    }
    return new StreamableHTTPClientTransport(new URL(registration.url));
  }
  if (!registration.command) {
    throw new Error(`MCP server '${serverKey}' has stdio transport but no command.`);
  }
  return new StdioClientTransport({
    command: registration.command,
    args: registration.args,
    // Deny-by-default: NEVER spread process.env here. See buildChildEnv above.
    env: buildChildEnv(registration.envAllowlist, ctx?.env ?? {})
  });
}

let transportFactory: TransportFactory = defaultTransport;

// Test seam: override how transports are created (e.g. an InMemoryTransport
// linked to an in-process server). Pass null to restore the real stdio factory.
export function setMcpTransportFactory(factory: TransportFactory | null): void {
  transportFactory = factory ?? defaultTransport;
}

type Connection = { client: Client; transport: Transport };
const connections = new Map<string, Connection>();

function connectionKey(serverName: string, ctx?: McpConnectContext): string {
  return ctx?.userId ? `${serverName}:${ctx.userId}` : serverName;
}

// Connect-or-reuse. Connections are kept warm and keyed per (server, user) so a
// run reuses one initialized session instead of re-handshaking per tool call.
export async function getClient(serverName: string, ctx?: McpConnectContext): Promise<Client> {
  if (!(await isConnectableMcpServer(serverName))) {
    throw new Error(`MCP server '${serverName}' is not registered for connection.`);
  }
  const key = connectionKey(serverName, ctx);
  const existing = connections.get(key);
  if (existing) return existing.client;

  const transport = await transportFactory(serverName, ctx);
  const client = new Client({ name: "agentdock-governed-client", version: "0.1.0" });
  await client.connect(transport);
  connections.set(key, { client, transport });
  return client;
}

// Discover a server's tools and their JSON input schemas (tools/list).
// Closes the connection after discovery so a subsequent run creates a fresh
// transport WITH the brokered credential (token) in its env.
export async function listMcpTools(serverName: string, ctx?: McpConnectContext): Promise<McpToolSchema[]> {
  const client = await getClient(serverName, ctx);
  try {
    const result = await client.listTools();
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? undefined,
      inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>
    }));
  } finally {
    // Always close — never let a tokenless discovery connection get reused by a run.
    await closeMcpConnection(serverName, ctx);
  }
}

// Invoke a tool by name with structured arguments (tools/call). The result text
// is flattened for the caller, which re-enters it as UNTRUSTED data and meters
// cost — this client neither trusts nor gates the result.
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  ctx?: McpConnectContext
): Promise<McpCallResult> {
  const client = await getClient(serverName, ctx);
  const result = await client.callTool({ name: toolName, arguments: args ?? {} });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((part): part is { type: "text"; text: string } => (part as { type?: string })?.type === "text")
    .map((part) => part.text)
    .join("\n");
  return { text, isError: Boolean(result.isError) };
}

export async function closeMcpConnection(serverName: string, ctx?: McpConnectContext): Promise<void> {
  const key = connectionKey(serverName, ctx);
  const conn = connections.get(key);
  if (!conn) return;
  await conn.client.close().catch(() => undefined);
  connections.delete(key);
}

export async function closeAllMcpConnections(): Promise<void> {
  for (const [key, conn] of Array.from(connections.entries())) {
    await conn.client.close().catch(() => undefined);
    connections.delete(key);
  }
}
