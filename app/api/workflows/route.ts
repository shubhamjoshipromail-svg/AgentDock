import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../auth";
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

async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const email = session?.user?.email;

  if (!userId && !email) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      OR: [
        ...(userId ? [{ id: userId }] : []),
        ...(email ? [{ email }] : [])
      ]
    }
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load saved workflows." }, { status: 401 });
  }

  const workflows = await prisma.workflow.findMany({
    where: { userId: user.id },
    include: {
      workflowAgents: {
        orderBy: { routeOrder: "asc" },
        include: { agent: true }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({ workflows });
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

  const agentInputs = body.agents ?? [];
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

  const workflow = await prisma.workflow.create({
    data: {
      userId: user.id,
      name: body.name,
      goal: body.goal,
      status: "active",
      weeklyBudgetCents: body.weeklyBudgetCents,
      maxRunBudgetCents: body.maxRunBudgetCents,
      approvalMode: body.approvalMode,
      workflowAgents: {
        create: agentInputs.flatMap((input) => {
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
        })
      }
    },
    include: {
      workflowAgents: {
        orderBy: { routeOrder: "asc" },
        include: { agent: true }
      }
    }
  });

  const skippedAgents = agentInputs
    .filter((input) => {
      const agent = (input.agentId ? agentById.get(input.agentId) : null) ?? agentByName.get(input.agentName ?? input.name ?? "");
      return !agent;
    })
    .map((input) => input.agentName ?? input.name ?? input.agentId ?? "Unknown agent");

  return NextResponse.json({ workflow, skippedAgents }, { status: 201 });
}
