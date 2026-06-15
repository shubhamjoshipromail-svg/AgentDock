import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";

// Run status + its immutable event timeline + pending approvals. Never selects
// secret columns.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await context.params;
  const run = await prisma.workflowRun.findFirst({
    where: { id, userId: user.id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      approvalRequests: { where: { status: "pending" }, orderBy: { requestedAt: "asc" } }
    }
  });
  if (!run) {
    return NextResponse.json({ message: "Run not found." }, { status: 404 });
  }
  return NextResponse.json({ run });
}
