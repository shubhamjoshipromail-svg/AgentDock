import { NextResponse } from "next/server";
import type { McpRiskLevel } from "@prisma/client";

import { prisma } from "../../../../lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const riskLevel = searchParams.get("riskLevel") as McpRiskLevel | null;
  const verified = searchParams.get("verified");

  try {
    const servers = await prisma.mcpServer.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(riskLevel ? { riskLevel } : {}),
        ...(verified ? { verified: verified === "true" } : {})
      },
      include: {
        tools: {
          orderBy: { name: "asc" }
        },
        workflowMcps: {
          include: { workflow: true },
          orderBy: { createdAt: "desc" }
        },
        accessGrants: {
          include: {
            workflow: true,
            agent: true
          },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: [
        { verified: "desc" },
        { riskLevel: "asc" },
        { displayName: "asc" }
      ]
    });

    return NextResponse.json({ servers });
  } catch (error) {
    console.error("MCP server load failed", error);
    return NextResponse.json({ message: "Unable to load MCP servers." }, { status: 500 });
  }
}
