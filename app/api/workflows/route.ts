import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../lib/auth-user";
import { agentDefaultsByName } from "../../../lib/catalog/agent-defaults";
import { defaultPermissionForRisk, grantTemplateForPermission } from "../../../lib/mcp-catalog";
import { prisma } from "../../../lib/prisma";
import { parseJsonBody } from "../../../lib/validation/parse";
import { createFlowSchema, type CreateFlowAgentInput, type CreateFlowInput } from "../../../lib/validation/schemas";

type WorkflowAgentInput = CreateFlowAgentInput;
type CreateWorkflowInput = CreateFlowInput;

const workflowInclude = {
  workflowAgents: {
    orderBy: { routeOrder: "asc" },
    include: { agent: true }
  },
  workflowMcps: {
    include: {
      mcpServer: true
    },
    orderBy: { createdAt: "desc" }
  },
  mcpAccessGrants: {
    include: {
      mcpServer: true,
      agent: true
    },
    orderBy: { createdAt: "desc" }
  }
} as const;

// TODO: split catalog vs install — agent rows are user-scoped for now; the
// Store should eventually read from a global catalog with per-user installs.
async function resolveWorkflowAgents(userId: string, agentInputs: WorkflowAgentInput[]) {
  if (agentInputs.length === 0) {
    return { workflowAgents: [], skippedAgents: [] };
  }

  const agentNames = agentInputs
    .map((agent) => agent.agentName ?? agent.name)
    .filter((name): name is string => Boolean(name));
  const agentIds = agentInputs
    .map((agent) => agent.agentId)
    .filter((id): id is string => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    .filter((id): id is string => Boolean(id));

  let matchedAgents = await prisma.agent.findMany({
    where: {
      userId,
      OR: [
        ...(agentNames.length ? [{ name: { in: agentNames } }] : []),
        ...(agentIds.length ? [{ id: { in: agentIds } }] : [])
      ]
    }
  });

  // Create any agent the user references that doesn't already exist for them.
  // Known catalog names use their rich defaults; arbitrary user-defined agents
  // get sane placeholder metadata so the built flow persists honestly.
  const missingAgentNames = agentNames.filter((name) => !matchedAgents.some((agent) => agent.name === name));

  for (const name of missingAgentNames) {
    const catalog = agentDefaultsByName[name];
    const defaults = catalog
      ? (({ name: _ignored, ...rest }) => rest)(catalog)
      : {
          category: "Custom",
          provider: "Custom",
          trustScore: 50,
          costPerTask: 5,
          tokenEfficiency: 50,
          verified: false,
          description: `${name} (user-defined agent)`
        };
    const agent = await prisma.agent.upsert({
      where: { userId_name: { userId, name } },
      update: defaults,
      create: { userId, name, ...defaults }
    });
    matchedAgents = [...matchedAgents, agent];
  }

  const agentByName = new Map(matchedAgents.map((agent) => [agent.name, agent]));
  const agentById = new Map(matchedAgents.map((agent) => [agent.id, agent]));

  return {
    workflowAgents: agentInputs.flatMap((input) => {
      const agent = (input.agentId ? agentById.get(input.agentId) : null) ?? agentByName.get(input.agentName ?? input.name ?? "");

      if (!agent) {
        return [];
      }

      return {
        agentId: agent.id,
        roleInWorkflow: input.roleInWorkflow,
        routeOrder: input.routeOrder,
        defaultMode: input.defaultMode
      };
    }),
    skippedAgents: agentInputs
      .filter((input) => {
        const agent = (input.agentId ? agentById.get(input.agentId) : null) ?? agentByName.get(input.agentName ?? input.name ?? "");
        return !agent;
      })
      .map((input) => input.agentName ?? input.name ?? input.agentId ?? "Unknown agent")
  };
}

// Resolve tool attachments to workflowMcp rows + per-tool access grants. Unknown
// mcpServerIds are skipped (reported back) rather than failing the whole save.
async function resolveWorkflowTools(workflowId: string, userId: string, tools: NonNullable<CreateWorkflowInput["tools"]>, tx: Prisma.TransactionClient) {
  const skippedTools: string[] = [];

  for (const tool of tools) {
    const mcpServer = await tx.mcpServer.findUnique({ where: { id: tool.mcpServerId } });

    if (!mcpServer) {
      skippedTools.push(tool.mcpServerId);
      continue;
    }

    const permission = tool.defaultPermission ?? defaultPermissionForRisk(mcpServer.riskLevel);
    const grantTemplate = grantTemplateForPermission(permission, mcpServer.riskLevel);

    await tx.workflowMcp.upsert({
      where: { workflowId_mcpServerId: { workflowId, mcpServerId: mcpServer.id } },
      update: { purpose: tool.purpose, defaultPermission: permission },
      create: { workflowId, mcpServerId: mcpServer.id, purpose: tool.purpose, defaultPermission: permission }
    });

    const existingGrant = await tx.mcpAccessGrant.findFirst({
      where: { userId, workflowId, mcpServerId: mcpServer.id }
    });

    if (existingGrant) {
      await tx.mcpAccessGrant.update({
        where: { id: existingGrant.id },
        data: { ...grantTemplate, allowedActions: grantTemplate.allowedActions, blockedActions: grantTemplate.blockedActions }
      });
    } else {
      await tx.mcpAccessGrant.create({
        data: {
          userId,
          workflowId,
          mcpServerId: mcpServer.id,
          ...grantTemplate,
          allowedActions: grantTemplate.allowedActions,
          blockedActions: grantTemplate.blockedActions
        }
      });
    }
  }

  return { skippedTools };
}

// Memory attachments scope an existing user partition to this flow by name.
async function attachWorkflowMemory(workflowId: string, userId: string, memory: NonNullable<CreateWorkflowInput["memory"]>, tx: Prisma.TransactionClient) {
  const skippedMemory: string[] = [];

  for (const attachment of memory) {
    const partition = await tx.memoryPartition.findFirst({
      where: { userId, name: attachment.partitionName }
    });

    if (!partition) {
      skippedMemory.push(attachment.partitionName);
      continue;
    }

    await tx.memoryPartition.update({
      where: { id: partition.id },
      data: { workflowId }
    });
  }

  return { skippedMemory };
}

async function saveWorkflowForUser(userId: string, body: CreateWorkflowInput) {
  const { workflowAgents, skippedAgents } = await resolveWorkflowAgents(userId, body.agents ?? []);
  const existingWorkflow = await prisma.workflow.findFirst({
    where: {
      userId,
      name: body.name
    }
  });

  const layout = (body.layout ?? undefined) as Prisma.InputJsonValue | undefined;

  const result = await prisma.$transaction(async (tx) => {
    const saved = existingWorkflow
      ? await (async () => {
          await tx.workflowAgent.deleteMany({ where: { workflowId: existingWorkflow.id } });
          return tx.workflow.update({
            where: { id: existingWorkflow.id },
            data: {
              goal: body.goal,
              status: "active",
              weeklyBudgetCents: body.weeklyBudgetCents,
              maxRunBudgetCents: body.maxRunBudgetCents,
              approvalMode: body.approvalMode,
              ...(layout !== undefined ? { layout } : {}),
              workflowAgents: { create: workflowAgents }
            }
          });
        })()
      : await tx.workflow.create({
          data: {
            userId,
            name: body.name,
            goal: body.goal,
            status: "active",
            weeklyBudgetCents: body.weeklyBudgetCents,
            maxRunBudgetCents: body.maxRunBudgetCents,
            approvalMode: body.approvalMode,
            ...(layout !== undefined ? { layout } : {}),
            workflowAgents: { create: workflowAgents }
          }
        });

    const { skippedTools } = await resolveWorkflowTools(saved.id, userId, body.tools ?? [], tx);
    const { skippedMemory } = await attachWorkflowMemory(saved.id, userId, body.memory ?? [], tx);

    const workflow = await tx.workflow.findUniqueOrThrow({
      where: { id: saved.id },
      include: workflowInclude
    });

    return { workflow, skippedTools, skippedMemory };
  });

  return { workflow: result.workflow, skippedAgents, skippedTools: result.skippedTools, skippedMemory: result.skippedMemory };
}

async function findWorkflowsForUser(userId: string) {
  return prisma.workflow.findMany({
    where: { userId },
    include: workflowInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load saved workflows." }, { status: 401 });
  }

  // Pure read: starter data creation lives in POST /api/bootstrap.
  const workflows = await findWorkflowsForUser(user.id);

  return NextResponse.json({ workflows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to save workflows." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, createFlowSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

  const { workflow, skippedAgents, skippedTools, skippedMemory } = await saveWorkflowForUser(user.id, body);

  return NextResponse.json({ workflow, skippedAgents, skippedTools, skippedMemory }, { status: 201 });
}
