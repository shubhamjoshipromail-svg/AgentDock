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

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load memory policy." }, { status: 401 });
  }

  try {
    // Pure read: starter data creation lives in POST /api/bootstrap.
    const partitions = await prisma.memoryPartition.findMany({
      where: { userId: user.id },
      include: memoryInclude,
      orderBy: { createdAt: "asc" }
    });

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

    return NextResponse.json({ partitions, grants, logs });
  } catch (error) {
    console.error("Memory load failed", error);
    return NextResponse.json({ message: "Unable to load memory policy." }, { status: 500 });
  }
}
