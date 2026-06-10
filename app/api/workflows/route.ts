import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";

type WorkflowAgentInput = {
  agentId?: string;
  agentName?: string;
  name?: string;
  roleInWorkflow: string;
  routeOrder: number;
  defaultMode: string;
};

type CreateWorkflowInput = {
  name: string;
  goal: string;
  weeklyBudgetCents: number;
  maxRunBudgetCents: number;
  approvalMode: "manual" | "approval_gated" | "autonomous_with_limits";
  agents?: WorkflowAgentInput[];
};

const starterWorkflow: CreateWorkflowInput = {
  name: "Job Search Automation",
  goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 150,
  approvalMode: "approval_gated",
  agents: [
    { agentName: "Job Discovery Agent", roleInWorkflow: "Discover roles", routeOrder: 1, defaultMode: "Autonomous discovery" },
    { agentName: "Company Research Agent", roleInWorkflow: "Research targets", routeOrder: 2, defaultMode: "Human-reviewed notes" },
    { agentName: "Resume Tailoring Agent", roleInWorkflow: "Tailor resume", routeOrder: 3, defaultMode: "Approval before export" },
    { agentName: "Outreach Draft Agent", roleInWorkflow: "Draft outreach", routeOrder: 4, defaultMode: "Draft-only" }
  ]
};

const mockAgentDefaults: Record<string, {
  category: string;
  provider: string;
  trustScore: number;
  costPerTask: number;
  tokenEfficiency: number;
  verified: boolean;
  description: string;
}> = {
  "Job Discovery Agent": {
    category: "Discovery",
    provider: "OpenAI",
    trustScore: 96,
    costPerTask: 9,
    tokenEfficiency: 91,
    verified: true,
    description: "Finds matching AI infrastructure roles and ranks fit."
  },
  "Company Research Agent": {
    category: "Research",
    provider: "Claude",
    trustScore: 92,
    costPerTask: 18,
    tokenEfficiency: 84,
    verified: true,
    description: "Builds company briefs and hiring signal summaries."
  },
  "Resume Tailoring Agent": {
    category: "Documents",
    provider: "OpenAI",
    trustScore: 89,
    costPerTask: 24,
    tokenEfficiency: 78,
    verified: true,
    description: "Tailors resume drafts with approval gates."
  },
  "Outreach Draft Agent": {
    category: "Communications",
    provider: "Gemini",
    trustScore: 94,
    costPerTask: 11,
    tokenEfficiency: 88,
    verified: true,
    description: "Drafts recruiter outreach without sending."
  }
};

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

async function resolveWorkflowAgents(agentInputs: WorkflowAgentInput[]) {
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
      OR: [
        ...(agentNames.length ? [{ name: { in: agentNames } }] : []),
        ...(agentIds.length ? [{ id: { in: agentIds } }] : [])
      ]
    }
  });

  const missingAgentNames = agentNames.filter((name) => !matchedAgents.some((agent) => agent.name === name) && mockAgentDefaults[name]);

  for (const name of missingAgentNames) {
    const defaults = mockAgentDefaults[name];
    const agent = await prisma.agent.upsert({
      where: { name },
      update: defaults,
      create: { name, ...defaults }
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
  const { workflowAgents, skippedAgents } = await resolveWorkflowAgents(body.agents ?? []);
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

  let workflows = await findWorkflowsForUser(user.id);
  let bootstrapped = false;

  if (workflows.length === 0) {
    await saveWorkflowForUser(user.id, starterWorkflow);
    workflows = await findWorkflowsForUser(user.id);
    bootstrapped = true;
  }

  return NextResponse.json({ workflows, bootstrapped });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to save workflows." }, { status: 401 });
  }

  const body = (await request.json()) as Partial<CreateWorkflowInput>;

  if (!body.name || !body.goal || !body.weeklyBudgetCents || !body.maxRunBudgetCents || !body.approvalMode) {
    return NextResponse.json({ message: "Missing required workflow fields." }, { status: 400 });
  }

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
