import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { curatedMcpServers } from "../../../../lib/mcp-catalog";
import { prisma } from "../../../../lib/prisma";

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to sync MCP registry metadata." }, { status: 401 });
  }

  try {
    let imported = 0;
    const now = new Date();

    for (const server of curatedMcpServers) {
      const mcpServer = await prisma.mcpServer.upsert({
        where: {
          registrySource_registryId: {
            registrySource: server.registrySource,
            registryId: server.registryId
          }
        },
        update: {
          name: server.name,
          displayName: server.displayName,
          description: server.description,
          homepageUrl: server.homepageUrl,
          repositoryUrl: server.repositoryUrl,
          packageName: server.packageName,
          packageRegistry: server.packageRegistry,
          version: server.version,
          verificationStatus: server.verificationStatus,
          riskLevel: server.riskLevel,
          recommendedPermission: server.recommendedPermission,
          category: server.category,
          installCommand: server.installCommand,
          metadata: { source: "agentdock-curated", safety: "metadata_only_no_execution" },
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
          version: server.version,
          verificationStatus: server.verificationStatus,
          riskLevel: server.riskLevel,
          recommendedPermission: server.recommendedPermission,
          category: server.category,
          installCommand: server.installCommand,
          metadata: { source: "agentdock-curated", safety: "metadata_only_no_execution" },
          lastSyncedAt: now
        }
      });

      for (const tool of server.tools) {
        await prisma.mcpTool.upsert({
          where: {
            mcpServerId_name: {
              mcpServerId: mcpServer.id,
              name: tool.name
            }
          },
          update: {
            description: tool.description,
            riskLevel: tool.riskLevel,
            inputSchema: {},
            metadata: { source: "curated_fallback" }
          },
          create: {
            mcpServerId: mcpServer.id,
            name: tool.name,
            description: tool.description,
            riskLevel: tool.riskLevel,
            inputSchema: {},
            metadata: { source: "curated_fallback" }
          }
        });
      }

      imported += 1;
    }

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        eventType: "mcp_tool_use",
        title: "MCP registry sync completed",
        description: `Imported or updated ${imported} MCP metadata records using the curated safe fallback registry.`,
        decision: "info",
        costCents: 0,
        metadata: {
          source: "mcp_registry_sync",
          imported,
          safety: "metadata_only_no_execution"
        }
      }
    });

    return NextResponse.json({ imported, source: "curated_fallback" });
  } catch (error) {
    console.error("MCP registry sync failed", error);
    return NextResponse.json({ message: "Unable to sync MCP registry metadata." }, { status: 500 });
  }
}
