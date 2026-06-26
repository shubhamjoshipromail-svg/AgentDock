import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { curatedServers } from "../../../../lib/registry/curated";
import { fetchOfficialRegistry } from "../../../../lib/registry/officialMcp";
import { curatedWins } from "../../../../lib/registry/normalize";
import type { NormalizedMcpServer } from "../../../../lib/registry/types";

async function upsertServer(server: NormalizedMcpServer, now: Date): Promise<"upserted" | "failed"> {
  try {
    const mcpServer = await prisma.mcpServer.upsert({
      where: {
        registrySource_registryId: {
          registrySource: server.registrySource,
          registryId: server.registryId
        }
      },
      update: {
        displayName: server.displayName,
        description: server.description,
        homepageUrl: server.homepageUrl,
        repositoryUrl: server.repositoryUrl,
        packageName: server.packageName,
        packageRegistry: server.packageRegistry,
        packageInfo: server.packageInfo ?? undefined,
        version: server.version,
        verificationStatus: server.verificationStatus,
        riskLevel: server.riskLevel,
        recommendedPermission: server.recommendedPermission,
        category: server.category ?? null,
        installCommand: server.installCommand ?? null,
        registryRaw: server.registryRaw ?? undefined,
        mcpServerKey: server.mcpServerKey ?? null,
        mcpToolName: server.mcpToolName ?? null,
        isExternalSend: server.isExternalSend ?? false,
        credentialProvider: server.credentialProvider ?? null,
        metadata: { source: server.registrySource, safety: "metadata_only_no_execution" },
        lastSyncedAt: now
      },
      create: {
        name: server.name,
        displayName: server.displayName,
        description: server.description,
        registrySource: server.registrySource,
        registryId: server.registryId,
        homepageUrl: server.homepageUrl,
        repositoryUrl: server.repositoryUrl,
        packageName: server.packageName,
        packageRegistry: server.packageRegistry,
        packageInfo: server.packageInfo ?? undefined,
        version: server.version,
        verificationStatus: server.verificationStatus,
        riskLevel: server.riskLevel,
        recommendedPermission: server.recommendedPermission,
        category: server.category ?? null,
        installCommand: server.installCommand ?? null,
        registryRaw: server.registryRaw ?? undefined,
        mcpServerKey: server.mcpServerKey ?? null,
        mcpToolName: server.mcpToolName ?? null,
        isExternalSend: server.isExternalSend ?? false,
        credentialProvider: server.credentialProvider ?? null,
        metadata: { source: server.registrySource, safety: "metadata_only_no_execution" },
        lastSyncedAt: now
      }
    });

    // Upsert tool metadata for curated servers (external servers have no tool lists)
    for (const tool of server.tools) {
      await prisma.mcpTool.upsert({
        where: { mcpServerId_name: { mcpServerId: mcpServer.id, name: tool.name } },
        update: { description: tool.description, riskLevel: tool.riskLevel },
        create: {
          mcpServerId: mcpServer.id,
          name: tool.name,
          description: tool.description,
          riskLevel: tool.riskLevel,
          inputSchema: {}
        }
      });
    }

    return "upserted";
  } catch (error) {
    console.error("[mcp-sync] Failed to upsert server", server.registryId, error);
    return "failed";
  }
}

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { message: "Unauthorized. Sign in to sync MCP registry metadata." },
      { status: 401 }
    );
  }

  const start = Date.now();
  const now = new Date();

  // --- Fetch official registry ---
  let fetched = 0;
  let registrySkipped = 0;
  let registryFailed = 0;
  let externalServers: NormalizedMcpServer[] = [];

  try {
    const result = await fetchOfficialRegistry();
    externalServers = result.servers;
    fetched = result.servers.length;
    registrySkipped = result.skipped;
    registryFailed = result.failed;
  } catch (error) {
    console.error("[mcp-sync] Registry fetch failed:", error);
    return NextResponse.json(
      {
        message: `Registry fetch failed: ${error instanceof Error ? error.message : "Unknown error"}. Existing catalog unchanged.`
      },
      { status: 502 }
    );
  }

  // --- Merge: curated judgment wins over external entry for the same package/repo ---
  const curatedRegistryIds = new Set(curatedServers.map((s) => s.registryId));
  const filteredExternal = externalServers.filter(
    (ext) =>
      !curatedRegistryIds.has(ext.registryId) &&
      !curatedServers.some((cur) => curatedWins(cur, ext))
  );

  const allServers = [...curatedServers, ...filteredExternal];

  // --- Upsert all servers ---
  let upserted = 0;
  let failed = registryFailed;

  for (const server of allServers) {
    const result = await upsertServer(server, now);
    if (result === "upserted") upserted++;
    else failed++;
  }

  const durationMs = Date.now() - start;
  const skipped = registrySkipped;

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      eventType: "mcp_tool_use",
      title: "MCP registry sync completed",
      description: `Fetched ${fetched} servers from official registry. Upserted ${upserted}, skipped ${skipped}, failed ${failed}. Duration: ${durationMs}ms.`,
      decision: "info",
      costCents: 0,
      metadata: {
        source: "mcp_registry_sync",
        fetched,
        upserted,
        skipped,
        failed,
        durationMs,
        safety: "metadata_only_no_execution"
      }
    }
  });

  return NextResponse.json({ fetched, upserted, skipped, failed, source: "mcp-official-registry", durationMs });
}
