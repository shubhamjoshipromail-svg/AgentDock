import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth-user";
import { prisma } from "../../../../../../lib/prisma";

// DELETE /api/workflows/[workflowId]/mcps/[mcpId]
// Remove a tool grant from a flow (reconcile on save, per Chunk 8).
// Revokes the McpAccessGrant for this workflow+server combination,
// and removes the WorkflowMcp attachment row.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workflowId: string; mcpId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { workflowId, mcpId } = await params;

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId: user.id }
  });
  if (!workflow) {
    return NextResponse.json({ message: "Flow not found." }, { status: 404 });
  }

  // The mcpId can be either a WorkflowMcp id or a McpServer id.
  // Look up the WorkflowMcp by its id first, then by mcpServerId as fallback.
  const wmcp = await prisma.workflowMcp.findFirst({
    where: {
      workflowId: workflow.id,
      OR: [{ id: mcpId }, { mcpServerId: mcpId }]
    }
  });

  if (!wmcp) {
    return NextResponse.json({ message: "Tool not attached to this flow." }, { status: 404 });
  }

  // Revoke the grant (don't delete — preserve audit history).
  await prisma.mcpAccessGrant.updateMany({
    where: {
      userId: user.id,
      workflowId: workflow.id,
      mcpServerId: wmcp.mcpServerId
    },
    data: { revokedAt: new Date() }
  });

  // Remove the attachment row.
  await prisma.workflowMcp.delete({ where: { id: wmcp.id } });

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      workflowId: workflow.id,
      eventType: "mcp_tool_use",
      title: "Tool removed from flow",
      description: `Tool grant revoked and removed from ${workflow.name}.`,
      decision: "info",
      costCents: 0,
      metadata: { source: "mcp_workflow_detach", mcpServerId: wmcp.mcpServerId }
    }
  });

  return NextResponse.json({ ok: true });
}
