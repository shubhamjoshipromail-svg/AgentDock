import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";

const workflowRunInclude = {
  workflow: true,
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      agent: true,
      memoryPartition: true
    }
  },
  approvalRequests: {
    orderBy: { requestedAt: "desc" },
    include: { agent: true }
  }
} as const;

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load workflow runs." }, { status: 401 });
  }

  try {
    const workflowRuns = await prisma.workflowRun.findMany({
      where: { userId: user.id },
      include: workflowRunInclude,
      orderBy: { createdAt: "desc" },
      take: 10
    });

    return NextResponse.json({ workflowRuns });
  } catch (error) {
    console.error("Workflow run load failed", error);
    return NextResponse.json({ message: "Unable to load workflow runs." }, { status: 500 });
  }
}
