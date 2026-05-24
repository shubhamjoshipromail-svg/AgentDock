import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../lib/auth-user";
import { prisma } from "../../../lib/prisma";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load activity." }, { status: 401 });
  }

  try {
    const activityLogs = await prisma.activityLog.findMany({
      where: { userId: user.id },
      include: {
        workflow: true,
        workflowRun: true,
        agent: true
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return NextResponse.json({ activityLogs });
  } catch (error) {
    console.error("Activity load failed", error);
    return NextResponse.json({ message: "Unable to load activity logs." }, { status: 500 });
  }
}
