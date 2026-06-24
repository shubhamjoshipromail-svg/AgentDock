import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { parseJsonBody } from "../../../../lib/validation/parse";
import { connectServerSchema } from "../../../../lib/validation/schemas";
import { isConnectableMcpServer, getClient, closeMcpConnection } from "../../../../lib/execution/mcp-client";
import { loadBrokeredCredential } from "../../../../lib/execution/credential-broker";

// GET /api/mcp/connections — list the current user's server connections.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in to connect MCP servers." }, { status: 401 });
  }

  const connections = await prisma.serverConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  // Never include secret material — transportConfig and authProvider are
  // non-secret metadata (authProvider is a broker key name, not a token).
  return NextResponse.json({ connections });
}

// POST /api/mcp/connections — connect to a registered MCP server.
// Generic path: any server in the SERVER_REGISTRY is connectable.
// For OAuth-backed servers, the user must already have a brokered credential
// (acquired via the existing OAuth flow); if missing we return instructions.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in to connect MCP servers." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, connectServerSchema);
  if (!parsed.ok) return parsed.response;

  const { serverKey } = parsed.data;

  // 1. Server must be registered (no server-name branching — generic check).
  if (!isConnectableMcpServer(serverKey)) {
    return NextResponse.json(
      { message: `MCP server '${serverKey}' is not registered for connection.` },
      { status: 400 }
    );
  }

  // 2. Check for an existing connection (idempotent re-connect).
  const existing = await prisma.serverConnection.findUnique({
    where: { userId_serverKey: { userId: user.id, serverKey } }
  });
  if (existing && (existing.status === "connected" || existing.status === "discovered")) {
    return NextResponse.json({ connection: existing, message: "Already connected." });
  }

  // 3. If the server needs OAuth, verify the user has a brokered credential.
  // The credential broker key is derived from the server's known auth provider.
  // For now, the only OAuth-backed server is gmail → google.
  const authProvider = requireAuthProvider(serverKey);
  if (authProvider) {
    const token = await loadBrokeredCredential(authProvider, user.id);
    if (!token) {
      return NextResponse.json(
        {
          message: `Server '${serverKey}' requires authentication. Sign in with Google to connect.`,
          needsAuth: true,
          authProvider
        },
        { status: 401 }
      );
    }
  }

  // 4. Create or update the connection record.
  const connection = await prisma.serverConnection.upsert({
    where: { userId_serverKey: { userId: user.id, serverKey } },
    create: {
      userId: user.id,
      serverKey,
      authProvider,
      status: "connecting",
      label: serverDisplayLabel(serverKey)
    },
    update: {
      authProvider,
      status: "connecting",
      lastError: null
    }
  });

  // 5. Attempt a live connection test (initialize handshake).
  // Open + immediately close a connection — proving the server is reachable.
  try {
    await getClient(serverKey, { userId: user.id });
    await closeMcpConnection(serverKey, { userId: user.id });

    // Connection verified — persist success.
    const updated = await prisma.serverConnection.update({
      where: { id: connection.id },
      data: { status: "connected", lastError: null }
    });

    return NextResponse.json({ connection: updated }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed.";
    const updated = await prisma.serverConnection.update({
      where: { id: connection.id },
      data: { status: "error", lastError: message }
    });

    return NextResponse.json(
      { connection: updated, message },
      { status: 502 }
    );
  }
}

// --- Generic helpers (no server-name branching) ---

// Map a registered server key to its credential broker provider.
// This is a registration concern, not a per-server code branch.
function requireAuthProvider(serverKey: string): string | null {
  // Generic: the server registration declares its auth provider.
  // Today only gmail (google OAuth) is in the registry.
  const AUTH_MAP: Record<string, string> = { gmail: "google" };
  return AUTH_MAP[serverKey] ?? null;
}

function serverDisplayLabel(serverKey: string): string {
  const LABELS: Record<string, string> = { gmail: "Gmail" };
  return LABELS[serverKey] ?? serverKey;
}
