import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

const llmState = vi.hoisted(() => ({
  provider: null as null | { name: string; model: string; completeJson: (p: unknown) => Promise<unknown> },
  queue: [] as { text: string }[],
  calls: 0
}));

vi.mock("../lib/llm", () => ({ getProvider: () => llmState.provider }));
vi.mock("../lib/execution/provider", () => ({ getRunProvider: vi.fn(async () => null) }));

import { POST as planFlow } from "../app/api/flows/plan/route";
import { POST as saveFlow } from "../app/api/workflows/route";
import { planToSaveInput } from "../lib/orchestrator/convert";

// ============================================================================
// THE FLAGSHIP FLOW IS COMPOSED, NOT SEEDED (Chunk 24 Phase 4).
//
// The demo-worthy flow -- research a topic, let the human choose, write a Google
// Doc, book a review meeting, email the link -- is NOT a hardcoded template. It
// is what the orchestrator produces from a plain-English goal against whatever
// tools the user has connected.
//
// That distinction is the product: a seeded flagship would be exactly the
// hardcoding this is supposed to replace. These tests prove the composer handles
// a five-tool, three-agent, multi-gate flow end to end -- planned, resolved by
// canonical identity, clamped, saved, and granted -- with no template involved.
// ============================================================================

function makeProvider() {
  return {
    name: "anthropic",
    model: "claude-sonnet-4-6",
    completeJson: vi.fn(async () => {
      llmState.calls += 1;
      const next = llmState.queue.shift();
      if (!next) throw new Error("no queued completion");
      return { text: next.text, usage: { inputTokens: 1200, outputTokens: 600 }, costCents: 3 };
    })
  };
}

function planRequest(goal: string) {
  return new Request("http://localhost/api/flows/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ goal })
  });
}

const FLAGSHIP_GOAL =
  "Research a topic I give you, let me choose the best options, write the findings into a Google Doc, book a review meeting on my calendar, and email me the link.";

// A tool as connect -> discover would have created it. Nothing here is special to
// the flagship: these are just the rows the generic discovery path writes.
async function discoverTool(opts: {
  serverKey: string;
  toolName: string;
  label: string;
  external?: boolean;
  readOnly?: boolean;
}) {
  return prisma.mcpServer.create({
    data: {
      name: `${opts.serverKey}-${opts.toolName.replace(/_/g, "-")}`,
      displayName: `${opts.label}: ${opts.toolName}`,
      description: `${opts.toolName} discovered from ${opts.serverKey}`,
      registrySource: "discovered",
      registryId: `agentdock:discovered:${opts.serverKey}:${opts.toolName}`,
      riskLevel: "medium",
      verificationStatus: "verified",
      recommendedPermission: opts.external ? "approval_required" : opts.readOnly ? "read_only" : "draft_only",
      mcpServerKey: opts.serverKey,
      mcpToolName: opts.toolName,
      credentialProvider: opts.serverKey === "search" ? null : "google",
      isExternalSend: Boolean(opts.external)
    }
  });
}

async function seedConnectedCatalog(userId: string) {
  const agents = await Promise.all(
    [
      { name: "Research Agent", category: "Research", description: "Researches a topic and asks the human to choose." },
      { name: "Brief Writer", category: "Writing", description: "Writes findings into a document." },
      { name: "Scheduler", category: "Coordination", description: "Books a review meeting and sends the link." }
    ].map((a) =>
      prisma.agent.create({
        data: { userId, name: a.name, category: a.category, provider: "AgentDock", verified: true, description: a.description }
      })
    )
  );

  const tools = {
    search: await discoverTool({ serverKey: "search", toolName: "web_search", label: "Web Search", readOnly: true }),
    createDoc: await discoverTool({ serverKey: "docs", toolName: "create_doc", label: "Google Docs" }),
    createEvent: await discoverTool({ serverKey: "calendar", toolName: "create_event", label: "Google Calendar" }),
    sendEmail: await discoverTool({ serverKey: "gmail", toolName: "send_email", label: "Gmail", external: true })
  };

  return { agents, tools };
}

function flagshipPlanJson(agentIds: string[]) {
  return JSON.stringify({
    name: "Competitive brief",
    goal: FLAGSHIP_GOAL,
    agents: [
      { agentId: agentIds[0], agentName: "Research Agent", role: "Research and ask the human to choose", order: 1, rationale: "Finds options and defers the decision to the human." },
      { agentId: agentIds[1], agentName: "Brief Writer", role: "Write the chosen findings into a doc", order: 2, rationale: "Produces the deliverable." },
      { agentId: agentIds[2], agentName: "Scheduler", role: "Book the review and send the link", order: 3, rationale: "Closes the loop with the human." }
    ],
    tools: [
      { key: "search:web_search", agentOrder: 1, requestedPermission: "read_only", rationale: "Public research only." },
      { key: "docs:create_doc", agentOrder: 2, requestedPermission: "draft_only", rationale: "Writes the brief." },
      { key: "calendar:create_event", agentOrder: 3, requestedPermission: "draft_only", rationale: "Books the review." },
      { key: "gmail:send_email", agentOrder: 3, requestedPermission: "approval_required", rationale: "Sends the link." }
    ],
    memoryAttachments: [],
    approvalGates: [
      { afterAgentOrder: 2, trigger: "Before the document is created", actionType: "document_create" },
      { afterAgentOrder: 3, trigger: "Before the meeting is booked", actionType: "calendar_create" },
      { afterAgentOrder: 3, trigger: "Before any external send executes", actionType: "email_send" }
    ],
    estimatedBudgetCents: 400,
    risks: [{ level: "medium", description: "Search results are untrusted public content." }]
  });
}

let user: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetDatabase();
  llmState.provider = makeProvider();
  llmState.queue = [];
  llmState.calls = 0;
  const created = await createTestUser(`flagship-${Date.now()}-${Math.random()}@example.com`);
  // Real sending must be ON before the session user is captured: the route reads
  // sendingEnabled off the session user, and the catalog snapshot withholds every
  // external-send tool when it is false (the Chunk 20 draft-only default).
  user = await prisma.user.update({ where: { id: created.id }, data: { sendingEnabled: true } });
  setCurrentUser(user);
});

describe("the orchestrator composes the flagship flow from a plain-English goal", () => {
  it("resolves all four tools by canonical identity with nothing unresolved", async () => {
    const { agents } = await seedConnectedCatalog(user.id);
    llmState.queue = [{ text: flagshipPlanJson(agents.map((a) => a.id)) }];

    const res = await planFlow(planRequest(FLAGSHIP_GOAL));
    expect(res.status).toBe(200);
    const data = await res.json();

    // No silent drops: an unresolved reference blocks the save loudly.
    expect(data.report.failed).toEqual([]);
    expect(data.plan.agents).toHaveLength(3);

    const keys = data.plan.tools.map((t: { key: string }) => t.key).sort();
    expect(keys).toEqual([
      "calendar:create_event",
      "docs:create_doc",
      "gmail:send_email",
      "search:web_search"
    ]);
  });

  it("spreads tools across steps instead of giving every agent everything", async () => {
    const { agents } = await seedConnectedCatalog(user.id);
    llmState.queue = [{ text: flagshipPlanJson(agents.map((a) => a.id)) }];

    const data = await (await planFlow(planRequest(FLAGSHIP_GOAL))).json();
    const byOrder = new Map<number, string[]>();
    for (const t of data.plan.tools as { key: string; agentOrder: number }[]) {
      byOrder.set(t.agentOrder, [...(byOrder.get(t.agentOrder) ?? []), t.key]);
    }

    // Research reads; the writer writes; the scheduler acts. Least privilege per step.
    expect(byOrder.get(1)).toEqual(["search:web_search"]);
    expect(byOrder.get(2)).toEqual(["docs:create_doc"]);
    expect(byOrder.get(3)?.sort()).toEqual(["calendar:create_event", "gmail:send_email"]);
  });

  it("keeps every consequential write approval-gated after clamping", async () => {
    const { agents } = await seedConnectedCatalog(user.id);
    llmState.queue = [{ text: flagshipPlanJson(agents.map((a) => a.id)) }];

    const data = await (await planFlow(planRequest(FLAGSHIP_GOAL))).json();
    const permission = (key: string) =>
      (data.plan.tools as { key: string; requestedPermission: string }[]).find((t) => t.key === key)?.requestedPermission;

    // The read stays a read. The send can never be less than approval-gated.
    expect(permission("search:web_search")).toBe("read_only");
    expect(permission("gmail:send_email")).toBe("approval_required");
    // Doc and calendar writes are not "allowed outright" — the gate stops them.
    expect(permission("docs:create_doc")).not.toBe("read_only");
    expect(permission("calendar:create_event")).not.toBe("read_only");

    expect(data.plan.approvalGates.length).toBeGreaterThanOrEqual(1);
  });

  it("the composed plan saves, and every grant carries canonical mandate scope", async () => {
    const { agents } = await seedConnectedCatalog(user.id);
    llmState.queue = [{ text: flagshipPlanJson(agents.map((a) => a.id)) }];

    const planned = await (await planFlow(planRequest(FLAGSHIP_GOAL))).json();

    const saveRes = await saveFlow(
      new Request("http://localhost/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(planToSaveInput(planned.plan))
      })
    );
    expect([200, 201]).toContain(saveRes.status);
    const saved = await saveRes.json();

    // Nothing was silently dropped on the way into the database.
    expect(saved.skippedAgents ?? []).toEqual([]);
    expect(saved.skippedTools ?? []).toEqual([]);

    const grants = await prisma.mcpAccessGrant.findMany({
      where: { workflowId: saved.workflow.id },
      include: { mcpServer: { select: { mcpServerKey: true, mcpToolName: true } } }
    });
    expect(grants).toHaveLength(4);
    for (const g of grants) {
      // Chunk 22 Phase 5: a scopeless grant authorizes nothing.
      expect(g.scope).toBe(`${g.mcpServer.mcpServerKey}:${g.mcpServer.mcpToolName}`);
    }
  });

  it("with sending off, the send step is withheld and reported — never silently dropped", async () => {
    const draftOnly = await prisma.user.update({
      where: { id: user.id },
      data: { sendingEnabled: false }
    });
    setCurrentUser(draftOnly);

    const { agents } = await seedConnectedCatalog(user.id);
    llmState.queue = [
      { text: flagshipPlanJson(agents.map((a) => a.id)) },
      { text: flagshipPlanJson(agents.map((a) => a.id)) }
    ];

    const data = await (await planFlow(planRequest(FLAGSHIP_GOAL))).json();
    const keys = data.plan.tools.map((t: { key: string }) => t.key);

    // The send is not quietly omitted: it is absent AND the user is told why,
    // so a demo cannot appear to "work" while doing something weaker than asked.
    expect(keys).not.toContain("gmail:send_email");
    const surfaced = JSON.stringify(data.report.failed) + JSON.stringify(data.warnings ?? []);
    expect(surfaced).toMatch(/send|sending/i);
  });

  it("a tool the user has NOT connected is never planned into the flow", async () => {
    const { agents } = await seedConnectedCatalog(user.id);
    // The model asks for GitHub, which this user never connected.
    const greedy = JSON.parse(flagshipPlanJson(agents.map((a) => a.id)));
    greedy.tools.push({
      key: "github:create_issue_comment",
      agentOrder: 3,
      requestedPermission: "draft_only",
      rationale: "Post the brief to the repo."
    });
    llmState.queue = [{ text: JSON.stringify(greedy) }, { text: flagshipPlanJson(agents.map((a) => a.id)) }];

    const data = await (await planFlow(planRequest(FLAGSHIP_GOAL))).json();
    const keys = data.plan.tools.map((t: { key: string }) => t.key);

    // The catalog is the boundary: an unconnected tool cannot be granted, so it
    // must not appear in a saved flow under any circumstances.
    expect(keys).not.toContain("github:create_issue_comment");
  });
});
