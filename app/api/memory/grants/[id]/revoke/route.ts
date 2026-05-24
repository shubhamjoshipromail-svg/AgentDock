import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth-user";
import { prisma } from "../../../../../../lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to revoke memory grants." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const grant = await prisma.memoryAccessGrant.findFirst({
      where: {
        id,
        userId: user.id
      },
      include: {
        partition: true,
        agent: true,
        workflow: true
      }
    });

    if (!grant) {
      return NextResponse.json({ message: "Memory access grant not found for the signed-in user." }, { status: 404 });
    }

    const updatedGrant = await prisma.$transaction(async (tx) => {
      const updated = await tx.memoryAccessGrant.update({
        where: { id: grant.id },
        data: {
          canRead: false,
          canWrite: false,
          canEdit: false,
          canDelete: false,
          canShare: false,
          requiresApproval: true
        },
        include: {
          partition: true,
          agent: true,
          workflow: true
        }
      });

      await tx.memoryAccessLog.create({
        data: {
          userId: user.id,
          partitionId: grant.partitionId,
          agentId: grant.agentId,
          workflowId: grant.workflowId,
          action: "edit",
          decision: "revoked",
          reason: `User revoked memory access for ${grant.agent?.name ?? "workflow"} on ${grant.partition.name}.`
        }
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: grant.workflowId,
          agentId: grant.agentId,
          eventType: "memory_access",
          title: "User revoked memory access",
          description: `User revoked ${grant.agent?.name ?? "workflow"} access to ${grant.partition.name}.`,
          decision: "denied",
          costCents: 0,
          metadata: {
            source: "memory_policy",
            partitionId: grant.partitionId,
            partitionName: grant.partition.name,
            agentName: grant.agent?.name
          }
        }
      });

      return updated;
    });

    return NextResponse.json({ grant: updatedGrant });
  } catch (error) {
    console.error("Memory grant revoke failed", error);
    return NextResponse.json({ message: "Unable to revoke memory access grant." }, { status: 500 });
  }
}
