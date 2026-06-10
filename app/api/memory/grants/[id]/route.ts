import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { prisma } from "../../../../../lib/prisma";
import { parseJsonBody } from "../../../../../lib/validation/parse";
import { memoryGrantPatchSchema, type MemoryGrantPatchInput } from "../../../../../lib/validation/schemas";

type PatchGrantInput = MemoryGrantPatchInput;

const editableFields = ["canRead", "canWrite", "canEdit", "canDelete", "canShare", "requiresApproval"] as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to edit memory grants." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = await parseJsonBody(request, memoryGrantPatchSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

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

    const data: PatchGrantInput = {};

    for (const field of editableFields) {
      if (typeof body[field] === "boolean") {
        data[field] = body[field];
      }
    }

    if ("expiresAt" in body) {
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
    }

    const updatedGrant = await prisma.$transaction(async (tx) => {
      const updated = await tx.memoryAccessGrant.update({
        where: { id: grant.id },
        data: {
          ...data,
          expiresAt: "expiresAt" in data ? (data.expiresAt ? new Date(data.expiresAt) : null) : undefined
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
          decision: updated.requiresApproval ? "approval_required" : "approved",
          reason: `User edited memory access for ${grant.agent?.name ?? "workflow"} on ${grant.partition.name}.`
        }
      });

      await tx.activityLog.create({
        data: {
          userId: user.id,
          workflowId: grant.workflowId,
          agentId: grant.agentId,
          eventType: "memory_access",
          title: "Memory access policy updated",
          description: `User edited ${grant.agent?.name ?? "workflow"} access to ${grant.partition.name}.`,
          decision: "info",
          costCents: 0,
          metadata: {
            source: "memory_policy",
            partitionId: grant.partitionId,
            partitionName: grant.partition.name,
            agentName: grant.agent?.name,
            updatedFields: Object.keys(data)
          }
        }
      });

      return updated;
    });

    return NextResponse.json({ grant: updatedGrant });
  } catch (error) {
    console.error("Memory grant update failed", error);
    return NextResponse.json({ message: "Unable to update memory access grant." }, { status: 500 });
  }
}
