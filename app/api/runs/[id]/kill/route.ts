import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { killRun } from "../../../../../lib/execution/run-engine";
import { markRunJobKilled } from "../../../../../lib/execution/run-queue";

// The kill switch: terminates an in-flight run. The drive loop checks run status
// at every boundary and stops before its next model/tool call.
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await context.params;
  const ok = await killRun(user.id, id);
  if (!ok) {
    return NextResponse.json({ message: "Run not found." }, { status: 404 });
  }
  await markRunJobKilled(user.id, id);
  return NextResponse.json({ ok: true });
}
