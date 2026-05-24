import { NextResponse } from "next/server";
import type { McpDefaultPermission } from "@prisma/client";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { defaultPermissionForRisk, grantTemplateForPermission } from "../../../../../lib/mcp-catalog";
import { prisma } from "../../../../../lib/prisma";

type AttachMcpInput = {
  mcpServerId?: string;
  purpose?: string;
  defaultPermission?: McpDefaultPermission;
};

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
  let body: AttachMcpInput;

  try {
    body = (await request.json()) as AttachMcpInput;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.mcpServerId) {
    return NextResponse.json({ message: "Missing mcpServerId." }, { status: 400 });
  }

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

    const defaultPermission = body.defaultPermission ?? defaultPermissionForRisk(mcpServer.riskLevel);
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
              blockedActions: grantTemplate.blockedActions
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
