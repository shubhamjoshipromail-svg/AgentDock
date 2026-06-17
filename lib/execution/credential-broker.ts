import { loadGoogleAccessToken } from "./credentials";

// The generic server-side credential broker. An MCP server that needs auth names
// a `credentialProvider`; the broker maps that provider to a server-side token
// loader. The token is handed to the MCP server's process env only — never to
// the agent or any client. Adding an OAuth-backed server is a new broker entry
// (or reuse of an existing provider), not a server-specific branch in execution.
const BROKERS: Record<string, (userId: string) => Promise<string | null>> = {
  google: loadGoogleAccessToken
};

export function hasCredentialBroker(provider: string): boolean {
  return provider in BROKERS;
}

export async function loadBrokeredCredential(provider: string, userId: string): Promise<string | null> {
  const broker = BROKERS[provider];
  if (!broker) return null;
  return broker(userId);
}
