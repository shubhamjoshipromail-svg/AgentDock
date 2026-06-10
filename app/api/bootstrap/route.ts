import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { agentDefaults } from "../../../lib/catalog/agent-defaults";
import { prisma } from "../../../lib/prisma";

// Idempotent per-user bootstrap. Called once from the client after sign-in;
// safe to call repeatedly. All starter data creation lives here so GET routes
// stay pure reads.
export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to bootstrap your workspace." }, { status: 401 });
  }

  try {
    const userId = user.id;
    const agents: Record<string, { id: string }> = {};

    for (const { name, ...defaults } of agentDefaults) {
      agents[name] = await prisma.agent.upsert({
        where: { userId_name: { userId, name } },
        update: defaults,
        create: { userId, name, ...defaults }
      });
    }

    let workflow = await prisma.workflow.findFirst({
      where: { userId, name: "Job Search Automation" }
    });
    let createdWorkflow = false;

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
      createdWorkflow = true;
    }

    const starterWorkflowAgents = [
      ["Job Discovery Agent", "Discover roles", 1, "Autonomous discovery"],
      ["Company Research Agent", "Research targets", 2, "Human-reviewed notes"],
      ["Resume Tailoring Agent", "Tailor resume", 3, "Approval before export"],
      ["Outreach Draft Agent", "Draft outreach", 4, "Draft-only"]
    ] as const;

    if (createdWorkflow) {
      for (const [agentName, roleInWorkflow, routeOrder, defaultMode] of starterWorkflowAgents) {
        await prisma.workflowAgent.upsert({
          where: {
            workflowId_agentId: {
              workflowId: workflow.id,
              agentId: agents[agentName].id
            }
          },
          update: {},
          create: {
            workflowId: workflow.id,
            agentId: agents[agentName].id,
            roleInWorkflow,
            routeOrder,
            defaultMode
          }
        });
      }
    }

    const partitionInputs = [
      ["Global Profile", "global", "medium", "User-level preferences and durable profile facts.", "approval_required", false],
      ["Job Search Memory", "workflow", "medium", "Roles, target companies, search criteria, and job-search preferences.", "workflow_scoped", true],
      ["Resume Memory", "workflow", "high", "Resume source, approved bullets, and work-history context.", "approval_required", true],
      ["Research Memory", "workflow", "medium", "Company briefs, recruiter notes, and opportunity research.", "workflow_scoped", true],
      ["Finance Memory", "domain", "restricted", "Finance preferences and sensitive financial context.", "blocked_by_default", false],
      ["Health Memory", "domain", "restricted", "Health-related context that agents cannot access by default.", "blocked_by_default", false],
      ["Travel Memory", "domain", "high", "Location, itinerary, and travel preference context.", "approval_required", false]
    ] as const;

    const partitions: Record<string, { id: string }> = {};
    const createdPartitions = new Set<string>();

    for (const [name, type, sensitivityLevel, description, defaultAccessPolicy, scopedToWorkflow] of partitionInputs) {
      const existing = await prisma.memoryPartition.findFirst({ where: { userId, name } });

      if (existing) {
        partitions[name] = existing;
        continue;
      }

      partitions[name] = await prisma.memoryPartition.create({
        data: {
          userId,
          workflowId: scopedToWorkflow ? workflow.id : null,
          name,
          type,
          sensitivityLevel,
          description,
          defaultAccessPolicy
        }
      });
      createdPartitions.add(name);
    }

    if (createdPartitions.has("Job Search Memory") || createdPartitions.has("Resume Memory") || createdPartitions.has("Research Memory")) {
      await prisma.memoryItem.createMany({
        data: [
          ...(createdPartitions.has("Job Search Memory") ? [{
            partitionId: partitions["Job Search Memory"].id,
            userId,
            title: "Target role pattern",
            content: "Prioritize AI agent infrastructure, control plane, and platform engineering roles.",
            sourceType: "user" as const,
            sourceWorkflowId: workflow.id,
            sensitivityLevel: "medium" as const,
            metadata: { tags: ["job-search", "preferences"], source: "bootstrap" }
          }] : []),
          ...(createdPartitions.has("Resume Memory") ? [{
            partitionId: partitions["Resume Memory"].id,
            userId,
            title: "Approved resume positioning",
            content: "Position around agent platforms, orchestration, safety, and high-trust product systems.",
            sourceType: "workflow" as const,
            sourceWorkflowId: workflow.id,
            sensitivityLevel: "high" as const,
            metadata: { tags: ["resume", "approved"], source: "bootstrap" }
          }] : []),
          ...(createdPartitions.has("Research Memory") ? [{
            partitionId: partitions["Research Memory"].id,
            userId,
            title: "Company research preference",
            content: "Summaries should include product surface, hiring signals, leadership, and recent funding.",
            sourceType: "agent" as const,
            sourceAgentId: agents["Company Research Agent"].id,
            sourceWorkflowId: workflow.id,
            sensitivityLevel: "medium" as const,
            metadata: { tags: ["research"], source: "bootstrap" }
          }] : [])
        ]
      });
    }

    const grantInputs: [string, string, { read?: boolean; write?: boolean; edit?: boolean; delete?: boolean; share?: boolean; approval?: boolean }][] = [
      ["Job Search Memory", "Job Discovery Agent", { read: true, write: true }],
      ["Job Search Memory", "Resume Tailoring Agent", { read: true, write: true }],
      ["Job Search Memory", "Company Research Agent", { read: true, write: true }],
      ["Job Search Memory", "Outreach Draft Agent", { read: true, write: true, approval: true }],
      ["Resume Memory", "Resume Tailoring Agent", { read: true, write: true, edit: true, approval: true }],
      ["Research Memory", "Company Research Agent", { read: true, write: true }],
      ["Research Memory", "Outreach Draft Agent", { read: true }],
      ["Finance Memory", "Finance Agent", { approval: true }],
      ["Health Memory", "Health Agent", { approval: true }]
    ];

    for (const [partitionName, agentName, flags] of grantInputs) {
      if (!createdPartitions.has(partitionName)) {
        continue;
      }

      await prisma.memoryAccessGrant.create({
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
    }

    if (createdPartitions.has("Job Search Memory") || createdPartitions.has("Health Memory")) {
      await prisma.memoryAccessLog.createMany({
        data: [
          ...(createdPartitions.has("Job Search Memory") ? [{
            userId,
            partitionId: partitions["Job Search Memory"].id,
            agentId: agents["Resume Tailoring Agent"].id,
            workflowId: workflow.id,
            action: "read" as const,
            decision: "allowed" as const,
            reason: "Resume Tailoring Agent read Job Search Memory within workflow grant."
          }] : []),
          ...(createdPartitions.has("Health Memory") ? [{
            userId,
            partitionId: partitions["Health Memory"].id,
            agentId: agents["Shopping Agent"].id,
            action: "read" as const,
            decision: "blocked" as const,
            reason: "Shopping Agent attempted to read Health Memory."
          }] : [])
        ]
      });
    }

    return NextResponse.json({
      bootstrapped: createdWorkflow || createdPartitions.size > 0,
      createdWorkflow,
      createdPartitions: Array.from(createdPartitions)
    });
  } catch (error) {
    console.error("Bootstrap failed", error);
    return NextResponse.json({ message: "Unable to bootstrap workspace." }, { status: 500 });
  }
}
