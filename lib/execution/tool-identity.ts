import type { McpServer } from "@prisma/client";

import { resolveRegistration } from "./mcp-client";

export type CanonicalToolIdentity = {
  serverKey: string;
  toolName: string;
  key: string;
};

// The mandate scope a grant for this tool must carry (Chunk 22 Phase 5).
//
// A grant's authority is named by the canonical identity of the tool it grants,
// so scope and execution identity can never drift apart. The broker denies a
// scopeless grant, so every write of an McpAccessGrant must set this.
// Returns null for a metadata-only catalog row (nothing executable to authorize).
export function grantScopeFor(server: Pick<McpServer, "mcpServerKey" | "mcpToolName">): string | null {
  return canonicalToolIdentity(server)?.key ?? null;
}

export function canonicalToolIdentity(server: Pick<McpServer, "mcpServerKey" | "mcpToolName">): CanonicalToolIdentity | null {
  if (!server.mcpServerKey || !server.mcpToolName) return null;
  return {
    serverKey: server.mcpServerKey,
    toolName: server.mcpToolName,
    key: `${server.mcpServerKey}:${server.mcpToolName}`
  };
}

export async function executableToolIdentity(
  server: Pick<McpServer, "mcpServerKey" | "mcpToolName">
): Promise<CanonicalToolIdentity | null> {
  const identity = canonicalToolIdentity(server);
  if (!identity) return null;
  const registration = await resolveRegistration(identity.serverKey);
  return registration ? identity : null;
}

export async function assertExecutableToolIdentity(
  server: Pick<McpServer, "displayName" | "mcpServerKey" | "mcpToolName">
): Promise<CanonicalToolIdentity> {
  const identity = await executableToolIdentity(server);
  if (!identity) {
    throw new Error(
      `${server.displayName} is not executable. Tools must resolve to a registered MCP server and discovered tool identity.`
    );
  }
  return identity;
}
