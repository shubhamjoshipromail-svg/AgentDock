import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { getProvider } from "../../../../lib/llm";
import { clampPermissions } from "../../../../lib/orchestrator/clamp";
import { planToSaveInput } from "../../../../lib/orchestrator/convert";
import { buildPrompt } from "../../../../lib/orchestrator/prompt";
import { resolvePlan } from "../../../../lib/orchestrator/resolve";
import { buildCatalogSnapshot } from "../../../../lib/orchestrator/snapshot";
import { flowPlanSchema, type FlowPlan, type PlannedFlowResponse } from "../../../../lib/orchestrator/schema";
import { prisma } from "../../../../lib/prisma";
import { parseJsonBody } from "../../../../lib/validation/parse";
import { planFlowSchema } from "../../../../lib/validation/schemas";
import { createFlowSchema } from "../../../../lib/validation/schemas";

// Cost governance, with safe defaults if env is unset.
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ACTIVITY_SOURCE = "orchestrator_plan";

// Strip accidental markdown fences before parsing model output.
function stripFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return trimmed;
}

type PlanIssue = { message: string; path?: readonly PropertyKey[] };
type ParseAttempt = { ok: true; data: FlowPlan } | { ok: false; issues: PlanIssue[] };

function tryParsePlan(text: string): ParseAttempt {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, issues: [{ message: "Response was not valid JSON." }] };
  }
  const result = flowPlanSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, issues: result.error.issues };
  }
  return { ok: true, data: result.data };
}

function summarizeIssues(issues: PlanIssue[]): string {
  return issues
    .slice(0, 8)
    .map((issue) => `${issue.path?.length ? issue.path.map(String).join(".") + ": " : ""}${issue.message}`)
    .join("; ");
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to plan a Flow." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, planFlowSchema);
  if (!parsed.ok) {
    return parsed.response;
  }
  const { goal } = parsed.data;

  const maxOutputTokens = intEnv("ORCHESTRATOR_MAX_OUTPUT_TOKENS", 4000);
  const maxCostPerCall = intEnv("ORCHESTRATOR_MAX_COST_CENTS_PER_CALL", 10);
  const dailyCap = intEnv("ORCHESTRATOR_DAILY_USER_COST_CAP_CENTS", 100);

  // --- Daily cost cap: checked BEFORE any provider call ---
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const spentToday = await prisma.activityLog.aggregate({
    _sum: { costCents: true },
    where: {
      userId: user.id,
      createdAt: { gte: startOfDay },
      metadata: { path: ["source"], equals: ACTIVITY_SOURCE }
    }
  });
  const todayTotal = spentToday._sum.costCents ?? 0;
  if (todayTotal >= dailyCap) {
    return NextResponse.json(
      { message: `Daily planning budget reached (${todayTotal}/${dailyCap} cents). Try again tomorrow.` },
      { status: 429 }
    );
  }

  // --- Provider availability ---
  const provider = getProvider();
  if (!provider) {
    return NextResponse.json(
      { message: "No model provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable planning." },
      { status: 503 }
    );
  }

  const snapshot = await buildCatalogSnapshot(user.id, goal);
  const { system, user: userPrompt } = buildPrompt(goal, snapshot);

  let totalCostCents = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let retried = false;
  const warnings: string[] = [];

  const started = Date.now();

  // Helper: log every call (success or failure) — never the goal or raw output.
  async function logPlan(title: string, description: string) {
    await prisma.activityLog.create({
      data: {
        userId: user!.id,
        eventType: "orchestration",
        title,
        description,
        decision: "info",
        costCents: totalCostCents,
        metadata: {
          source: ACTIVITY_SOURCE,
          provider: provider!.name,
          model: provider!.model,
          inputTokens,
          outputTokens,
          durationMs: Date.now() - started,
          retried,
          goalLength: goal.length
        }
      }
    });
  }

  let attempt: ParseAttempt;
  try {
    const first = await provider.completeJson({ system, user: userPrompt, maxOutputTokens });
    totalCostCents += first.costCents;
    inputTokens += first.usage.inputTokens;
    outputTokens += first.usage.outputTokens;
    attempt = tryParsePlan(first.text);

    if (!attempt.ok) {
      if (first.costCents > maxCostPerCall) {
        // Over the per-call cap: do not spend a second call.
        warnings.push("First planning call exceeded the per-call cost cap; retry skipped.");
      } else {
        retried = true;
        const retryPrompt = `${userPrompt}\n\nYour previous response failed validation: ${summarizeIssues(attempt.issues)}. Respond again with ONLY corrected JSON.`;
        const second = await provider.completeJson({ system, user: retryPrompt, maxOutputTokens });
        totalCostCents += second.costCents;
        inputTokens += second.usage.inputTokens;
        outputTokens += second.usage.outputTokens;
        attempt = tryParsePlan(second.text);
      }
    }
  } catch (error) {
    await logPlan("Flow plan failed", "Model provider request failed.");
    return NextResponse.json(
      { message: `Model provider error: ${error instanceof Error ? error.message : "unknown"}.` },
      { status: 502 }
    );
  }

  if (!attempt.ok) {
    await logPlan("Flow plan failed validation", "Model output did not match the plan schema after one retry.");
    return NextResponse.json(
      { message: "The model could not produce a valid plan. Try rephrasing your goal.", issues: attempt.issues },
      { status: 422 }
    );
  }

  // --- Resolve unresolvable references, then clamp permissions server-side ---
  const resolved = resolvePlan(attempt.data, snapshot);
  const clamped = clampPermissions(resolved.plan);
  warnings.push(...resolved.warnings, ...clamped.warnings);

  // Convert availability check: confirm the plan maps onto the real save payload.
  if (!createFlowSchema.safeParse(planToSaveInput(clamped.plan)).success) {
    warnings.push("This plan may need edits before it can be saved.");
  }

  await logPlan(
    "Flow plan generated",
    `Planned ${clamped.plan.agents.length} agents and ${clamped.plan.tools.length} tools.`
  );

  const response: PlannedFlowResponse = {
    plan: clamped.plan,
    warnings,
    planMeta: {
      provider: provider.name,
      model: provider.model,
      inputTokens,
      outputTokens,
      costCents: totalCostCents,
      durationMs: Date.now() - started
    }
  };

  return NextResponse.json(response);
}
