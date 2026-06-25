// Curated first-party server registrations — DATA, not execution control flow.
//
// These mirror the seeded `ServerRegistration` rows so a fresh database (and the
// test database, which truncates between runs) can still reach the first-party
// servers without a code change to execution. The DB table is authoritative; this
// list is the bootstrap/fallback source the seed upserts from and the resolver
// falls back to. Adding a NEW server is a new row (seed/admin) — never a branch
// in execution code.
//
// SECURITY: a `command` is a local process AgentDock will spawn. This list is
// curated/vetted in-repo; there is intentionally no path for an ordinary user to
// add an entry with an arbitrary command (that would be RCE). Remote-URL
// (http/sse) servers are the safer general path for future third-party servers,
// gated behind a separate trust chunk.

export type CuratedTransport = "stdio" | "http" | "sse";

export type CuratedRegistration = {
  serverKey: string;
  displayName: string;
  transport: CuratedTransport;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  credentialProvider?: string | null;
  tokenEnvVar?: string | null;
};

export const CURATED_SERVER_REGISTRATIONS: CuratedRegistration[] = [
  {
    // Gmail — first-party stdio MCP server, OAuth via the generic broker (google).
    serverKey: "gmail",
    displayName: "Gmail",
    transport: "stdio",
    command: process.env.GMAIL_MCP_COMMAND ?? process.execPath,
    args: (process.env.GMAIL_MCP_ARGS ?? "servers/gmail/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: "google",
    tokenEnvVar: "GMAIL_ACCESS_TOKEN"
  },
  {
    // Web search — first-party stdio MCP server, read-only, no credential. Web
    // search is "just another MCP server" reached via the standard client.
    serverKey: "search",
    displayName: "Web Search",
    transport: "stdio",
    command: process.env.SEARCH_MCP_COMMAND ?? process.execPath,
    args: (process.env.SEARCH_MCP_ARGS ?? "servers/search/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: null,
    tokenEnvVar: null
  }
];

export function findCuratedRegistration(serverKey: string): CuratedRegistration | undefined {
  return CURATED_SERVER_REGISTRATIONS.find((r) => r.serverKey === serverKey);
}
