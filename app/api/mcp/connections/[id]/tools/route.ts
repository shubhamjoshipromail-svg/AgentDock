import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth-user";
import { prisma } from "../../../../../../lib/prisma";

// GET /api/mcp/connections/[id]/tools — list the discovered tools for a connection.
export async function GET(
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

  const servers = await prisma.mcpServer.findMany({
    where: { mcpServerKey: connection.serverKey },
    include: { tools: { orderBy: { name: "asc" } } },
    orderBy: { mcpToolName: "asc" }
  });

  const tools = servers.map((s) => ({
    serverRowId: s.id,
    serverKey: s.mcpServerKey!,
    toolName: s.mcpToolName!,
    displayName: s.displayName,
    description: s.description,
    inputSchema: s.tools[0]?.inputSchema ?? null,
    isExternalSend: s.isExternalSend,
    riskLevel: s.riskLevel
  }));

  return NextResponse.json({ tools });
}
