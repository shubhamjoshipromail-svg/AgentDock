import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { parseJsonBody } from "../../../../lib/validation/parse";
import { sendingSettingSchema } from "../../../../lib/validation/schemas";

// Real-sending posture. Draft-only is the default for new users: they can create
// (approval-gated) drafts but cannot be granted an external-send tool until they
// deliberately turn sending on here. Enabling does NOT bypass approval — every
// consequential send still hits the approval gate at run time.

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json({ sendingEnabled: user.sendingEnabled });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, sendingSettingSchema);
  if (!parsed.ok) return parsed.response;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { sendingEnabled: parsed.data.enabled },
    select: { sendingEnabled: true }
  });

  return NextResponse.json({ sendingEnabled: updated.sendingEnabled });
}
