import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { parseQuery } from "../../../../lib/validation/parse";
import { toolServersQuerySchema } from "../../../../lib/validation/schemas";

export async function GET(request: Request) {
  // Auth-gate for consistency with every other API route. This returns only the
  // global, non-secret MCP catalog, but there is no reason for it to be readable
  // by anonymous callers when its sibling routes (e.g. /api/mcp/registrations)
  // require a session.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in to browse the tool catalog." }, { status: 401 });
  }

  const parsed = parseQuery(request.url, toolServersQuerySchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { category, riskLevel, verification, source, q, cursor, limit: rawLimit } = parsed.data;
  const pageSize = rawLimit ?? 24;

  try {
    const where = {
      ...(category ? { category } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      ...(verification ? { verificationStatus: verification } : {}),
      ...(source ? { registrySource: source } : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, servers] = await Promise.all([
      prisma.mcpServer.count({ where }),
      prisma.mcpServer.findMany({
        where,
        include: {
          tools: { orderBy: { name: "asc" } }
        },
        orderBy: [
          { verificationStatus: "asc" },
          { displayName: "asc" }
        ],
        take: pageSize + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      })
    ]);

    const hasMore = servers.length > pageSize;
    const page = hasMore ? servers.slice(0, pageSize) : servers;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return NextResponse.json({ servers: page, nextCursor, total });
  } catch (error) {
    console.error("MCP server load failed", error);
    return NextResponse.json({ message: "Unable to load MCP servers." }, { status: 500 });
  }
}
