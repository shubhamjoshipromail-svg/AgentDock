import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { computeFunnel, isFounderEmail } from "../../../../lib/analytics/product-events";

// Founder-only activation-funnel summary — the adoption-evidence dashboard.
// Gated by the FOUNDER_EMAILS allow-list; to anyone else (including signed-in
// non-founders) it 404s, so its existence isn't even disclosed. Returns ids +
// per-stage counts + activation only — no user content.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  // 404 (not 403) for non-founders: don't reveal the route exists.
  if (!user || !isFounderEmail(user.email)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  const funnel = await computeFunnel();
  return NextResponse.json({
    ...funnel,
    // The ordered funnel stages, so the client can render them in sequence.
    stages: [
      "signup",
      "key_added",
      "flow_planned",
      "grant_created",
      "run_started",
      "run_started_repeat",
      "approval_shown",
      "approval_resolved",
      "action_executed_real",
      "run_completed",
      "deliverable_viewed"
    ],
    generatedAt: new Date().toISOString()
  });
}
