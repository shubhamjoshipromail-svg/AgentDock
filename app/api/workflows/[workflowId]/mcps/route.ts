import { NextResponse } from "next/server";
import type { McpDefaultPermission } from "@prisma/client";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { defaultPermissionForRisk, grantTemplateForPermission } from "../../../../../lib/mcp-catalog";
import { prisma } from "../../../../../lib/prisma";
import { executableToolIdentity } from "../../../../../lib/execution/tool-identity";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { toolAttachSchema } from "../../../../../lib/validation/schemas";

const workflowMcpInclude = {
  mcpServer: {
    include: {
      tools: {
        orderBy: { name: "asc" }
      }
    }
  },
  workflow: true
} as const;

const grantInclude = {
  mcpServer: true,
  workflow: true,
  agent: true
} as const;

export async function GET(_request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load attached MCPs." }, { status: 401 });
  }

  const { workflowId } = await context.params;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        userId: user.id
      }
    });

    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found for the signed-in user." }, { status: 404 });
    }

    const workflowMcps = await prisma.workflowMcp.findMany({
      where: { workflowId: workflow.id },
      include: workflowMcpInclude,
      orderBy: { createdAt: "desc" }
    });

    const grants = await prisma.mcpAccessGrant.findMany({
      where: {
        userId: user.id,
        workflowId: workflow.id
      },
      include: grantInclude,
      orderBy: { createdAt: "desc" }
    });

    const attachments = workflowMcps.map((workflowMcp) => ({
      workflowMcp,
      mcpServer: workflowMcp.mcpServer,
      accessGrant: grants.find((grant) => grant.mcpServerId === workflowMcp.mcpServerId) ?? null
    }));

    return NextResponse.json({ attachments, workflowMcps, grants });
  } catch (error) {
    console.error("MCP workflow load failed", error);
    return NextResponse.json({ message: "Unable to load workflow MCP attachments." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to attach MCP metadata to workflows." }, { status: 401 });
  }

  const { workflowId } = await context.params;
  const parsed = await parseJsonBody(request, toolAttachSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        userId: user.id
      }
    });

    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found for the signed-in user." }, { status: 404 });
    }

    const mcpServer = await prisma.mcpServer.findUnique({
      where: { id: body.mcpServerId }
    });

    if (!mcpServer) {
      return NextResponse.json({ message: "MCP server metadata not found. Sync the MCP registry first." }, { status: 404 });
    }

    const identity = await executableToolIdentity(mcpServer);
    if (!identity) {
      return NextResponse.json(
        {
          message:
            "This tool is catalog metadata only and cannot be attached until it has a registered executable MCP identity."
        },
        { status: 400 }
      );
    }

    // Draft-only default: a user who has not enabled real sending cannot be
    // granted an external-send tool. Drafting stays available (and approval-
    // gated); enabling send is a deliberate action in Profile. This is the
    // authoritative enforcement point — with no send grant, the runtime gate
    // blocks the send by deny-by-default regardless of what was planned.
    if (mcpServer.isExternalSend && !user.sendingEnabled) {
      return NextResponse.json(
        {
          message:
            "Real sending is off for your account. You can attach drafting tools now (drafts still require your approval). To grant a tool that sends externally, enable real sending in Profile first.",
          code: "sending_disabled"
        },
        { status: 403 }
      );
    }

    const defaultPermission = body.defaultPermission ?? mcpServer.recommendedPermission;
    const grantTemplate = grantTemplateForPermission(defaultPermission, mcpServer.riskLevel);

    const result = await prisma.$transaction(async (tx) => {
      const workflowMcp = await tx.workflowMcp.upsert({
        where: {
          workflowId_mcpServerId: {
            workflowId: workflow.id,
            mcpServerId: mcpServer.id
          }
        },
        update: {
          purpose: body.purpose,
          defaultPermission
        },
        create: {
          workflowId: workflow.id,
          mcpServerId: mcpServer.id,
          purpose: body.purpose,
          defaultPermission
        },
        include: {
          mcpServer: {
            include: {
              tools: {
                orderBy: { name: "asc" }
              }
            }
          },
          workflow: true
        }
      });

      const existingGrant = await tx.mcpAccessGrant.findFirst({
        where: {
          userId: user.id,
          workflowId: workflow.id,
          mcpServerId: mcpServer.id
        }
      });

      const accessGrant = existingGrant
        ? await tx.mcpAccessGrant.update({
            where: { id: existingGrant.id },
            data: {
              ...grantTemplate,
              allowedActions: grantTemplate.allowedActions,
              blockedActions: grantTemplate.blockedActions,
              revokedAt: null // clear any prior revocation on re-grant
            },
            include: {
              mcpServer: true,
              workflow: true,
              agent: true
            }
          })
        : await tx.mcpAccessGrant.create({
            data: {
              userId: user.id,
              workflowId: workflow.id,
              mcpServerId: mcpServer.id,
              ...grantTemplate,
              allowedActions: grantTemplate.allowedActions,
              blockedActions: grantTemplate.blockedActions
            },
            include: {
              mcpServer: true,
              workflow: true,
              agent: true
            }
          });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: workflow.id,
          eventType: "mcp_tool_use",
          title: "MCP attached to workflow",
          description: `${mcpServer.displayName} attached to ${workflow.name} with ${defaultPermission.replaceAll("_", " ")} permission.`,
          decision: "info",
          costCents: 0,
          metadata: {
            source: "mcp_workflow_attach",
            mcpServerId: mcpServer.id,
            mcpName: mcpServer.displayName,
            riskLevel: mcpServer.riskLevel,
            defaultPermission,
            permissionTemplate: grantTemplate
          }
        }
      });

      return { workflowMcp, accessGrant };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("MCP workflow attach failed", error);
    return NextResponse.json({ message: "Unable to attach MCP to workflow." }, { status: 500 });
  }
}
