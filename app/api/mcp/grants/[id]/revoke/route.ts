import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth-user";
import { prisma } from "../../../../../../lib/prisma";

const grantInclude = {
  mcpServer: true,
  workflow: true,
  agent: true
} as const;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to revoke MCP access." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const grant = await prisma.mcpAccessGrant.findFirst({
      where: {
        id,
        userId: user.id
      },
      include: grantInclude
    });

    if (!grant) {
      return NextResponse.json({ message: "MCP access grant not found for the signed-in user." }, { status: 404 });
    }

    const updatedGrant = await prisma.$transaction(async (tx) => {
      const updated = await tx.mcpAccessGrant.update({
        where: { id: grant.id },
        data: {
          canRead: false,
          canWrite: false,
          canExecute: false,
          canDelete: false,
          requiresApproval: true,
          allowedActions: [],
          blockedActions: ["read", "write", "execute", "delete"]
        },
        include: grantInclude
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: grant.workflowId,
          agentId: grant.agentId,
          eventType: "mcp_tool_use",
          title: "MCP access revoked",
          description: `${grant.mcpServer.displayName} access revoked for ${grant.workflow?.name ?? "workflow"}.`,
          decision: "denied",
          costCents: 0,
          metadata: {
            source: "mcp_grant_revoke",
            grantId: grant.id,
            mcpServerId: grant.mcpServerId,
            mcpName: grant.mcpServer.displayName
          }
        }
      });

      return updated;
    });

    return NextResponse.json({ grant: updatedGrant });
  } catch (error) {
    console.error("MCP grant revoke failed", error);
    return NextResponse.json({ message: "Unable to revoke MCP access." }, { status: 500 });
  }
}
