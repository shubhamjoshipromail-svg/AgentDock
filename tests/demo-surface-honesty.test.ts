import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { effectiveGrantPermission } from "../lib/execution/policy-gate";

// ============================================================================
// EVERY SURFACE ON THE DEMO PATH SHOWS ONLY TRUE INFORMATION (Chunk 24 Phase 5).
//
// A governance product that displays invented governance numbers is disqualifying:
// the whole claim is that what you see is what is enforced. Two of these were
// live -- a "$5.00 weekly cap" that exists nowhere in the schema, API, or engine,
// and a hardcoded per-run cap that contradicted the flow's real budget on the
// adjacent screen.
// ============================================================================

const ROOT = path.resolve(__dirname, "..");

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  user = await createTestUser(`honesty-${Date.now()}-${Math.random()}@example.com`);
  setCurrentUser(user);
});

describe("spend figures come from the server, not from the client", () => {
  it("GET /api/runs reports the caps the server actually enforces", async () => {
    const { GET } = await import("../app/api/runs/route");
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.spend).toBeTruthy();
    // These are the two limits genuinely enforced: the daily cap is checked before
    // any provider call, and runMaxCostCents is where the engine halts.
    expect(typeof body.spend.todayCents).toBe("number");
    expect(body.spend.dailyCapCents).toBeGreaterThan(0);
    expect(body.spend.runMaxCostCents).toBeGreaterThan(0);
  });

  it("today's spend reflects real run cost, not whatever happens to be listed", async () => {
    const workflow = await prisma.workflow.create({
      data: {
        userId: user.id, name: "F", goal: "g", weeklyBudgetCents: 500,
        maxRunBudgetCents: 100, approvalMode: "approval_gated"
      }
    });
    await prisma.workflowRun.create({
      data: {
        userId: user.id, workflowId: workflow.id, status: "completed",
        riskLevel: "medium", startedAt: new Date(), totalCostCents: 37,
        idempotencyKey: `k-${Math.random()}`
      }
    });

    const { GET } = await import("../app/api/runs/route");
    const body = await (await GET()).json();
    expect(body.spend.todayCents).toBe(37);
  });
});

describe("no invented governance numbers remain on the demo path", () => {
  // A source assertion is right here because the property IS static: "no invented
  // currency constant appears in a governance surface". It is not standing in for
  // behaviour -- the behaviour is covered above.
  const DEMO_SURFACES = [
    "components/control/ControlPlane.tsx",
    "components/workspace/FlowWorkspace.tsx"
  ];

  it("the fabricated weekly cap and hardcoded run cap are gone", () => {
    for (const rel of DEMO_SURFACES) {
      const source = readFileSync(path.join(ROOT, rel), "utf8");
      // Strip comments so the explanation of what was removed does not trip this.
      const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, `${rel} still declares a hardcoded run cap`).not.toMatch(/RUN_CAP_CENTS/);
      expect(code, `${rel} still renders an invented weekly cap`).not.toMatch(/weekly cap/i);
    }
  });
});

describe("grant display matches what the gate enforces", () => {
  it("a grant with no capability bits is BLOCKED, never a green check", () => {
    expect(
      effectiveGrantPermission({
        canRead: false, canWrite: false, canExecute: false, canDelete: false, requiresApproval: false
      })
    ).toBe("blocked");
  });

  it("the workspace derives permission from the gate's own function", () => {
    const source = readFileSync(path.join(ROOT, "components/workspace/FlowWorkspace.tsx"), "utf8");
    // Deriving permission separately from the gate is exactly how a blocked grant
    // came to render as "read only" with a check mark.
    expect(source).toMatch(/effectiveGrantPermission\(/);
    expect(source).not.toMatch(/g\.requiresApproval \? "approval_required" : g\.canWrite/);
  });

  it("a blocked or revoked grant renders with the blocked treatment", () => {
    const source = readFileSync(path.join(ROOT, "components/workspace/FlowWorkspace.tsx"), "utf8");
    expect(source).toMatch(/permission === "blocked"/);
    expect(source).toMatch(/kind: "blocked"/);
  });

  it("participant grants are filtered to the agent that holds them", () => {
    const source = readFileSync(path.join(ROOT, "components/workspace/FlowWorkspace.tsx"), "utf8");
    // Without this filter every agent card listed every grant in the flow, so a
    // per-agent revoke control was actually flow-wide.
    expect(source).toMatch(/g\.agentId == null \|\| g\.agentId === wa\.agent\.id/);
  });
});

describe("a render failure never shows as a blank panel", () => {
  it("a global error boundary exists", () => {
    const source = readFileSync(path.join(ROOT, "app/global-error.tsx"), "utf8");
    expect(source).toMatch(/export default function GlobalError/);
    // It must surface the real reason, not a generic apology.
    expect(source).toMatch(/error\.message/);
  });
});
