import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { agentDefaultsByName } from "../../../lib/catalog/agent-defaults";
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

  const missingAgentNames = agentNames.filter((name) => !matchedAgents.some((agent) => agent.name === name) && agentDefaultsByName[name]);

  for (const name of missingAgentNames) {
    const { name: _ignored, ...defaults } = agentDefaultsByName[name]!;
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

async function saveWorkflowForUser(userId: string, body: CreateWorkflowInput) {
  const { workflowAgents, skippedAgents } = await resolveWorkflowAgents(userId, body.agents ?? []);
  const existingWorkflow = await prisma.workflow.findFirst({
    where: {
      userId,
      name: body.name
    }
  });

  const workflow = existingWorkflow
    ? await prisma.$transaction(async (tx) => {
        await tx.workflowAgent.deleteMany({ where: { workflowId: existingWorkflow.id } });

        return tx.workflow.update({
          where: { id: existingWorkflow.id },
          data: {
            goal: body.goal,
            status: "active",
            weeklyBudgetCents: body.weeklyBudgetCents,
            maxRunBudgetCents: body.maxRunBudgetCents,
            approvalMode: body.approvalMode,
            workflowAgents: {
              create: workflowAgents
            }
          },
          include: workflowInclude
        });
      })
    : await prisma.workflow.create({
        data: {
          userId,
          name: body.name,
          goal: body.goal,
          status: "active",
          weeklyBudgetCents: body.weeklyBudgetCents,
          maxRunBudgetCents: body.maxRunBudgetCents,
          approvalMode: body.approvalMode,
          workflowAgents: {
            create: workflowAgents
          }
        },
        include: workflowInclude
      });

  return { workflow, skippedAgents };
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

  const { workflow, skippedAgents } = await saveWorkflowForUser(user.id, {
    name: body.name,
    goal: body.goal,
    weeklyBudgetCents: body.weeklyBudgetCents,
    maxRunBudgetCents: body.maxRunBudgetCents,
    approvalMode: body.approvalMode,
    agents: body.agents ?? []
  });

  return NextResponse.json({ workflow, skippedAgents }, { status: 201 });
}
