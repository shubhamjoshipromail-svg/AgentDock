import { NextResponse } from "next/server";
import type { DefaultAccessPolicy, MemoryAction, AccessDecision, MemoryPartitionType, MemorySourceType, SensitivityLevel } from "@prisma/client";

import { getCurrentUser } from "../../../lib/auth-user";
import { agentDefaults } from "../../../lib/catalog/agent-defaults";
import {
  starterMemoryGrants,
  starterMemoryItems,
  starterMemoryLogs,
  starterMemoryPartitions
} from "../../../lib/catalog/templates";
import { ensureVettedFlowsForUser } from "../../../lib/catalog/vetted-flows";
import { prisma } from "../../../lib/prisma";

// Idempotent per-user bootstrap. Called once from the client after sign-in;
// safe to call repeatedly. All starter data creation lives here so GET routes
// stay pure reads. The starter content itself is defined in
// lib/catalog/templates.ts.
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

    // One concurrency-safe installer owns the managed MVP flows for fresh and
    // returning users. It never deletes user-created flows and never reactivates
    // a vetted flow the user explicitly archived.
    const vetted = await ensureVettedFlowsForUser(prisma, userId);
    const workflow = vetted.workflows[0];
    if (!workflow) throw new Error("Vetted flow bootstrap returned no workflows.");
    const createdWorkflow = vetted.createdWorkflowNames.length > 0;

    const partitions: Record<string, { id: string }> = {};
    const createdPartitions = new Set<string>();

    for (const partition of starterMemoryPartitions) {
      const existing = await prisma.memoryPartition.findFirst({ where: { userId, name: partition.name } });

      if (existing) {
        partitions[partition.name] = existing;
        continue;
      }

      partitions[partition.name] = await prisma.memoryPartition.create({
        data: {
          userId,
          workflowId: partition.scopedToStarterFlow ? workflow.id : null,
          name: partition.name,
          type: partition.type as MemoryPartitionType,
          sensitivityLevel: partition.sensitivityLevel as SensitivityLevel,
          description: partition.description,
          defaultAccessPolicy: partition.defaultAccessPolicy as DefaultAccessPolicy
        }
      });
      createdPartitions.add(partition.name);
    }

    const newItems = starterMemoryItems.filter((item) => createdPartitions.has(item.partitionName));

    if (newItems.length) {
      await prisma.memoryItem.createMany({
        data: newItems.map((item) => ({
          partitionId: partitions[item.partitionName].id,
          userId,
          title: item.title,
          content: item.content,
          sourceType: item.sourceType as MemorySourceType,
          sourceAgentId: item.sourceAgentName ? agents[item.sourceAgentName]?.id : undefined,
          sourceWorkflowId: workflow.id,
          sensitivityLevel: item.sensitivityLevel as SensitivityLevel,
          metadata: item.metadata
        }))
      });
    }

    for (const grant of starterMemoryGrants) {
      if (!createdPartitions.has(grant.partitionName)) {
        continue;
      }

      const flags = grant.flags as { read?: boolean; write?: boolean; edit?: boolean; delete?: boolean; share?: boolean; approval?: boolean };
      await prisma.memoryAccessGrant.create({
        data: {
          partitionId: partitions[grant.partitionName].id,
          agentId: agents[grant.agentName].id,
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

    const newLogs = starterMemoryLogs.filter((log) => createdPartitions.has(log.partitionName));

    if (newLogs.length) {
      await prisma.memoryAccessLog.createMany({
        data: newLogs.map((log) => ({
          userId,
          partitionId: partitions[log.partitionName].id,
          agentId: agents[log.agentName]?.id,
          workflowId: log.scopedToStarterFlow ? workflow.id : undefined,
          action: log.action as MemoryAction,
          decision: log.decision as AccessDecision,
          reason: log.reason
        }))
      });
    }

    return NextResponse.json({
      bootstrapped: createdWorkflow || createdPartitions.size > 0,
      createdWorkflow,
      createdWorkflows: vetted.createdWorkflowNames,
      createdPartitions: Array.from(createdPartitions)
    });
  } catch (error) {
    console.error("Bootstrap failed", error);
    return NextResponse.json({ message: "Unable to bootstrap workspace." }, { status: 500 });
  }
}
