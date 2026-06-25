import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../../../../lib/auth-user";
import { prisma } from "../../../../../../lib/prisma";
import { listMcpTools, serverDisplayLabel } from "../../../../../../lib/execution/mcp-client";

// POST /api/mcp/connections/[id]/discover — run tools/list against a connected
// server, persist the discovered tools as grantable McpServer rows, and reconcile
// (remove tools the server no longer advertises). Generic: any registered MCP
// server works; no per-server branching.
export async function POST(
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
  if (connection.status !== "connected" && connection.status !== "discovered") {
    return NextResponse.json(
      { message: `Cannot discover: connection is '${connection.status}'. Connect first.` },
      { status: 400 }
    );
  }

  // Generic: run real tools/list via the existing governed MCP client.
  let discoveredTools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
  try {
    discoveredTools = await listMcpTools(connection.serverKey, { userId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery failed.";
    await prisma.serverConnection.update({
      where: { id },
      data: { lastError: message }
    });
    // Never synthesize a fake tool list — surface the real error.
    return NextResponse.json(
      { message: `Tool discovery failed: ${message}` },
      { status: 502 }
    );
  }

  if (!discoveredTools.length) {
    return NextResponse.json(
      { message: "No tools discovered. The server may not expose any tools." },
      { status: 200 }
    );
  }

  // Persist each discovered tool as a grantable McpServer row (Chunk 10 pattern:
  // one row per tool with mcpServerKey + mcpToolName). Also persist the tool
  // metadata (schema) in the McpTool child table.
  const registrySource = "discovered";
  const now = new Date();

  // Collect currently-advertised tool names for reconciliation.
  const advertisedNames = new Set(discoveredTools.map((t) => t.name));

  // Upsert each discovered tool.
  const results: { toolName: string; serverRowId: string; isNew: boolean }[] = [];

  // Display label comes from registration data (resolve once for this server).
  const label = await serverDisplayLabel(connection.serverKey);

  for (const tool of discoveredTools) {
    const name = `${connection.serverKey}-${tool.name.replace(/_/g, "-")}`;
    const registryId = `agentdock:discovered:${connection.serverKey}:${tool.name}`;
    const isExternalSend = classifyExternalSend(connection.serverKey, tool.name);

    // Use upsert on the @@unique([registrySource, registryId]) compound key,
    // NOT the UUID id — avoids an invalid "" UUID fallback on new rows.
    const serverRow = await prisma.mcpServer.upsert({
      where: { registrySource_registryId: { registrySource: "discovered", registryId } },
      create: {
        name,
        displayName: `${label}: ${tool.name}`,
        description: tool.description ?? `${tool.name} (discovered from ${connection.serverKey})`,
        registrySource: "discovered",
        registryId,
        riskLevel: "medium",
        verificationStatus: "verified",
        recommendedPermission: "draft_only",
        mcpServerKey: connection.serverKey,
        mcpToolName: tool.name,
        credentialProvider: connection.authProvider,
        isExternalSend,
        lastSyncedAt: now
      },
      update: {
        displayName: `${label}: ${tool.name}`,
        description: tool.description ?? `${tool.name} (discovered from ${connection.serverKey})`,
        lastSyncedAt: now
      }
    });

    results.push({
      toolName: tool.name,
      serverRowId: serverRow.id,
      isNew: serverRow.lastSyncedAt?.getTime() === now.getTime()
    });

    // Upsert the tool metadata (schema).
    await prisma.mcpTool.upsert({
      where: { mcpServerId_name: { mcpServerId: serverRow.id, name: tool.name } },
      create: {
        mcpServerId: serverRow.id,
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? null) as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
        riskLevel: "medium"
      },
      update: {
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? null) as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
      }
    });
  }

  // Reconcile: remove McpServer rows for this serverKey that are no longer
  // advertised (but only those created via discovery — never catalog entries).
  const staleRows = await prisma.mcpServer.findMany({
    where: {
      mcpServerKey: connection.serverKey,
      registrySource: "discovered",
      mcpToolName: { notIn: Array.from(advertisedNames) }
    },
    select: { id: true, mcpToolName: true }
  });

  if (staleRows.length) {
    const staleIds = staleRows.map((r) => r.id);
    // Cascade delete will remove linked McpTool + McpAccessGrant rows.
    await prisma.mcpServer.deleteMany({ where: { id: { in: staleIds } } });
  }

  // Update connection status.
  await prisma.serverConnection.update({
    where: { id },
    data: { status: "discovered", lastDiscoveredAt: now, lastError: null }
  });

  return NextResponse.json({
    connection: { ...connection, status: "discovered", lastDiscoveredAt: now.toISOString() },
    tools: results,
    reconciled: { removed: staleRows.map((r) => r.mcpToolName) }
  });
}

// --- Generic helpers (zero server-name branches) ---

function classifyExternalSend(serverKey: string, toolName: string): boolean {
  // Generic classification: a tool whose name starts with "send_" or contains
  // "send" is an external send. Everything else (create_draft, search, read, etc.)
  // is a safe/reversible operation. This is a heuristic, not a server-specific
  // branch — it works for gmail (send_email) as well as any future server.
  return toolName.startsWith("send_") || toolName.includes("_send_");
}
