import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { closeMcpConnection } from "../../../../../lib/execution/mcp-client";

// DELETE /api/mcp/connections/[id] — disconnect and revoke dependent grants.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const connection = await prisma.serverConnection.findFirst({
    where: { id, userId: user.id }
  });
  if (!connection) {
    return NextResponse.json({ message: "Connection not found." }, { status: 404 });
  }

  // 1. Close any warm MCP transport (ignores if not open).
  try {
    await closeMcpConnection(connection.serverKey, { userId: user.id });
  } catch {
    // Best-effort — the transport may already be closed or errored.
  }

  // 2. Revoke dependent grants: McpAccessGrant rows linked to servers whose
  //    mcpServerKey matches this connection's serverKey, owned by this user.
  //    This implements the Chunk 6/8 reconcile-on-disconnect semantics.
  const dependentServers = await prisma.mcpServer.findMany({
    where: { mcpServerKey: connection.serverKey },
    select: { id: true }
  });
  const serverIds = dependentServers.map((s) => s.id);

  if (serverIds.length) {
    await prisma.mcpAccessGrant.updateMany({
      where: { userId: user.id, mcpServerId: { in: serverIds } },
      data: { revokedAt: new Date() }
    });
  }

  // 3. Mark the connection as disconnected (preserves history).
  await prisma.serverConnection.update({
    where: { id },
    data: { status: "disconnected" }
  });

  return NextResponse.json({ ok: true });
}
