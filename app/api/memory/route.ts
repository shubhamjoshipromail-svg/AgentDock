import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";

const memoryInclude = {
  workflow: true,
  memoryItems: {
    orderBy: { createdAt: "desc" }
  },
  accessGrants: {
    include: {
      agent: true,
      workflow: true
    },
    orderBy: { createdAt: "asc" }
  },
  accessLogs: {
    include: {
      agent: true,
      workflow: true,
      memoryItem: true
    },
    orderBy: { createdAt: "desc" },
    take: 8
  }
} as const;

const agentDefaults = [
  ["Job Discovery Agent", "Discovery", "OpenAI", 96, 9, 91, true, "Finds matching AI infrastructure roles and ranks fit."],
  ["Resume Tailoring Agent", "Documents", "OpenAI", 89, 24, 78, true, "Tailors resume drafts with approval gates."],
  ["Company Research Agent", "Research", "Claude", 92, 18, 84, true, "Builds company briefs and hiring signal summaries."],
  ["Outreach Draft Agent", "Communications", "Gemini", 94, 11, 88, true, "Drafts recruiter outreach without sending."],
  ["Shopping Agent", "Commerce", "Open-source", 81, 7, 82, false, "Compares products and prices with strict memory isolation."],
  ["Finance Agent", "Finance", "Claude", 86, 16, 80, true, "Summarizes finance tasks with restricted memory defaults."],
  ["Health Agent", "Health", "OpenAI", 88, 20, 76, true, "Handles health notes with restricted memory defaults."]
] as const;

async function bootstrapMemoryProfile(userId: string) {
  const agents: Record<string, { id: string }> = {};

  for (const [name, category, provider, trustScore, costPerTask, tokenEfficiency, verified, description] of agentDefaults) {
    agents[name] = await prisma.agent.upsert({
      where: { name },
      update: { category, provider, trustScore, costPerTask, tokenEfficiency, verified, description },
      create: { name, category, provider, trustScore, costPerTask, tokenEfficiency, verified, description }
    });
  }

  let workflow = await prisma.workflow.findFirst({
    where: {
      userId,
      name: "Job Search Automation"
    }
  });

  if (!workflow) {
    workflow = await prisma.workflow.create({
      data: {
        userId,
        name: "Job Search Automation",
        goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
        status: "active",
        weeklyBudgetCents: 500,
        maxRunBudgetCents: 150,
        approvalMode: "approval_gated"
      }
    });
  }

  const partitionInputs = [
    ["Global Profile", "global", "medium", "User-level preferences and durable profile facts.", "approval_required", null],
    ["Job Search Memory", "workflow", "medium", "Roles, target companies, search criteria, and job-search preferences.", "workflow_scoped", workflow.id],
    ["Resume Memory", "workflow", "high", "Resume source, approved bullets, and work-history context.", "approval_required", workflow.id],
    ["Research Memory", "workflow", "medium", "Company briefs, recruiter notes, and opportunity research.", "workflow_scoped", workflow.id],
    ["Finance Memory", "domain", "restricted", "Finance preferences and sensitive financial context.", "blocked_by_default", null],
    ["Health Memory", "domain", "restricted", "Health-related context that agents cannot access by default.", "blocked_by_default", null],
    ["Travel Memory", "domain", "high", "Location, itinerary, and travel preference context.", "approval_required", null]
  ] as const;

  const partitions: Record<string, { id: string }> = {};

  for (const [name, type, sensitivityLevel, description, defaultAccessPolicy, workflowId] of partitionInputs) {
    partitions[name] = await prisma.memoryPartition.create({
      data: {
        userId,
        workflowId,
        name,
        type,
        sensitivityLevel,
        description,
        defaultAccessPolicy
      }
    });
  }

  await prisma.memoryItem.createMany({
    data: [
      {
        partitionId: partitions["Job Search Memory"].id,
        userId,
        title: "Target role pattern",
        content: "Prioritize AI agent infrastructure, control plane, and platform engineering roles.",
        sourceType: "user",
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "medium",
        metadata: { tags: ["job-search", "preferences"], source: "bootstrap" }
      },
      {
        partitionId: partitions["Resume Memory"].id,
        userId,
        title: "Approved resume positioning",
        content: "Position around agent platforms, orchestration, safety, and high-trust product systems.",
        sourceType: "workflow",
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "high",
        metadata: { tags: ["resume", "approved"], source: "bootstrap" }
      },
      {
        partitionId: partitions["Research Memory"].id,
        userId,
        title: "Company research preference",
        content: "Summaries should include product surface, hiring signals, leadership, and recent funding.",
        sourceType: "agent",
        sourceAgentId: agents["Company Research Agent"].id,
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "medium",
        metadata: { tags: ["research"], source: "bootstrap" }
      }
    ]
  });

  const grant = (partitionName: string, agentName: string, flags: { read?: boolean; write?: boolean; edit?: boolean; delete?: boolean; share?: boolean; approval?: boolean }) =>
    prisma.memoryAccessGrant.create({
      data: {
        partitionId: partitions[partitionName].id,
        agentId: agents[agentName].id,
        workflowId: workflow.id,
        userId,
        canRead: Boolean(flags.read),
        canWrite: Boolean(flags.write),
        canEdit: Boolean(flags.edit),
        canDelete: Boolean(flags.delete),
        canShare: Boolean(flags.share),
        requiresApproval: Boolean(flags.approval)
      }
    });

  await Promise.all([
    grant("Job Search Memory", "Job Discovery Agent", { read: true, write: true }),
    grant("Job Search Memory", "Resume Tailoring Agent", { read: true, write: true }),
    grant("Job Search Memory", "Company Research Agent", { read: true, write: true }),
    grant("Job Search Memory", "Outreach Draft Agent", { read: true, write: true, approval: true }),
    grant("Resume Memory", "Resume Tailoring Agent", { read: true, write: true, edit: true, approval: true }),
    grant("Research Memory", "Company Research Agent", { read: true, write: true }),
    grant("Research Memory", "Outreach Draft Agent", { read: true }),
    grant("Finance Memory", "Finance Agent", { approval: true }),
    grant("Health Memory", "Health Agent", { approval: true })
  ]);

  await prisma.memoryAccessLog.createMany({
    data: [
      {
        userId,
        partitionId: partitions["Job Search Memory"].id,
        agentId: agents["Resume Tailoring Agent"].id,
        workflowId: workflow.id,
        action: "read",
        decision: "allowed",
        reason: "Resume Tailoring Agent read Job Search Memory within workflow grant."
      },
      {
        userId,
        partitionId: partitions["Health Memory"].id,
        agentId: agents["Shopping Agent"].id,
        action: "read",
        decision: "blocked",
        reason: "Shopping Agent attempted to read Health Memory."
      }
    ]
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load memory policy." }, { status: 401 });
  }

  try {
    let partitions = await prisma.memoryPartition.findMany({
      where: { userId: user.id },
      include: memoryInclude,
      orderBy: { createdAt: "asc" }
    });
    let bootstrapped = false;

    if (partitions.length === 0) {
      await bootstrapMemoryProfile(user.id);
      partitions = await prisma.memoryPartition.findMany({
        where: { userId: user.id },
        include: memoryInclude,
        orderBy: { createdAt: "asc" }
      });
      bootstrapped = true;
    }

    const grants = await prisma.memoryAccessGrant.findMany({
      where: { userId: user.id },
      include: {
        partition: true,
        agent: true,
        workflow: true
      },
      orderBy: { createdAt: "asc" }
    });

    const logs = await prisma.memoryAccessLog.findMany({
      where: { userId: user.id },
      include: {
        partition: true,
        memoryItem: true,
        agent: true,
        workflow: true
      },
      orderBy: { createdAt: "desc" },
      take: 30
    });

    return NextResponse.json({ partitions, grants, logs, bootstrapped });
  } catch (error) {
    console.error("Memory load failed", error);
    return NextResponse.json({ message: "Unable to load memory policy." }, { status: 500 });
  }
}
