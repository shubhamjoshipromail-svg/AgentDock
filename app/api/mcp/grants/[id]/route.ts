import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";

type PatchMcpGrantInput = {
  canRead?: boolean;
  canWrite?: boolean;
  canExecute?: boolean;
  canDelete?: boolean;
  requiresApproval?: boolean;
  allowedActions?: string[];
  blockedActions?: string[];
};

const grantInclude = {
  mcpServer: true,
  workflow: true,
  agent: true
} as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to edit MCP grants." }, { status: 401 });
  }

  const { id } = await context.params;
  let body: PatchMcpGrantInput;

  try {
    body = (await request.json()) as PatchMcpGrantInput;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

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
          canRead: typeof body.canRead === "boolean" ? body.canRead : undefined,
          canWrite: typeof body.canWrite === "boolean" ? body.canWrite : undefined,
          canExecute: typeof body.canExecute === "boolean" ? body.canExecute : undefined,
          canDelete: typeof body.canDelete === "boolean" ? body.canDelete : undefined,
          requiresApproval: typeof body.requiresApproval === "boolean" ? body.requiresApproval : undefined,
          allowedActions: Array.isArray(body.allowedActions) ? body.allowedActions : undefined,
          blockedActions: Array.isArray(body.blockedActions) ? body.blockedActions : undefined
        },
        include: grantInclude
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: grant.workflowId,
          agentId: grant.agentId,
          eventType: "mcp_tool_use",
          title: "MCP access grant updated",
          description: `${grant.mcpServer.displayName} permission grant updated for ${grant.workflow?.name ?? "workflow"}.`,
          decision: "info",
          costCents: 0,
          metadata: {
            source: "mcp_grant_update",
            grantId: grant.id,
            mcpServerId: grant.mcpServerId,
            mcpName: grant.mcpServer.displayName,
            updatedFields: Object.keys(body)
          }
        }
      });

      return updated;
    });

    return NextResponse.json({ grant: updatedGrant });
  } catch (error) {
    console.error("MCP grant update failed", error);
    return NextResponse.json({ message: "Unable to update MCP access grant." }, { status: 500 });
  }
}
