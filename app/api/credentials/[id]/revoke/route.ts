import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../lib/auth-user";
import { revokeCredential } from "../../../../../lib/execution/credentials";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await context.params;
  const ok = await revokeCredential(user.id, id);
  if (!ok) {
    return NextResponse.json({ message: "Credential not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
