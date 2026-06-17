import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

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

// Only first-party, allowlisted servers may be connected this chunk. There is no
// arbitrary-URL path — connecting untrusted third-party servers is a separate
// trust/vetting chunk. A server absent from this set cannot be reached at all.
const ALLOWLIST = new Set(["gmail"]);

export function isConnectableMcpServer(serverName: string): boolean {
  return ALLOWLIST.has(serverName);
}

// AgentDock represents each discovered MCP tool as its own grantable McpServer
// row whose `name` encodes both the backing server and the tool, so the existing
// one-row-one-tool grant model works unchanged: `mcp:<server>:<tool>`.
// e.g. "mcp:gmail:create_draft", "mcp:gmail:send_email".
export function isMcpToolServer(serverName: string): boolean {
  return serverName.startsWith("mcp:");
}

export function parseMcpServerName(serverName: string): { server: string; tool: string } | null {
  const match = /^mcp:([^:]+):(.+)$/.exec(serverName);
  return match ? { server: match[1], tool: match[2] } : null;
}

export type TransportFactory = (serverName: string, ctx?: McpConnectContext) => Transport | Promise<Transport>;

// The real transport spawns the first-party server over stdio. Tests inject an
// in-memory transport instead (no child process), exercising the exact same
// client code path.
function defaultStdioTransport(serverName: string, ctx?: McpConnectContext): Transport {
  if (serverName !== "gmail") {
    throw new Error(`No transport configured for MCP server '${serverName}'.`);
  }
  const command = process.env.GMAIL_MCP_COMMAND ?? process.execPath;
  const args = (process.env.GMAIL_MCP_ARGS ?? "servers/gmail/dist/index.js").split(" ").filter(Boolean);
  return new StdioClientTransport({
    command,
    args,
    env: { ...(process.env as Record<string, string>), ...(ctx?.env ?? {}) }
  });
}

let transportFactory: TransportFactory = defaultStdioTransport;

// Test seam: override how transports are created (e.g. an InMemoryTransport
// linked to an in-process server). Pass null to restore the real stdio factory.
export function setMcpTransportFactory(factory: TransportFactory | null): void {
  transportFactory = factory ?? defaultStdioTransport;
}

type Connection = { client: Client; transport: Transport };
const connections = new Map<string, Connection>();

function connectionKey(serverName: string, ctx?: McpConnectContext): string {
  return ctx?.userId ? `${serverName}:${ctx.userId}` : serverName;
}

// Connect-or-reuse. Connections are kept warm and keyed per (server, user) so a
// run reuses one initialized session instead of re-handshaking per tool call.
async function getClient(serverName: string, ctx?: McpConnectContext): Promise<Client> {
  if (!isConnectableMcpServer(serverName)) {
    throw new Error(`MCP server '${serverName}' is not allowlisted for connection.`);
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
export async function listMcpTools(serverName: string, ctx?: McpConnectContext): Promise<McpToolSchema[]> {
  const client = await getClient(serverName, ctx);
  const result = await client.listTools();
  return (result.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? undefined,
    inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>
  }));
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
