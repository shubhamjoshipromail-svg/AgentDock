import { NextResponse } from "next/server";

import { prisma } from "../../../../lib/prisma";
import { parseQuery } from "../../../../lib/validation/parse";
import { toolServersQuerySchema } from "../../../../lib/validation/schemas";

export async function GET(request: Request) {
  const parsed = parseQuery(request.url, toolServersQuerySchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { category, riskLevel, verified } = parsed.data;

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
