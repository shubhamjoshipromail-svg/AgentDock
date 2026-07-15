import type { CatalogSnapshot, CatalogSnapshotTool } from "./schema";
import type { ResolvedFlow } from "./resolve";

// Goal-capability validation (Chunk 19 Phase 3).
//
// Capability tags are DERIVED FROM DATA — the canonical identity's tool-name
// part, the Chunk-16 isExternalSend classification, and the recommended
// permission — never from per-tool if-statements or display names. The same
// derivation works over a catalog of 5 tools or 500.

export type Capability = "search" | "draft" | "send";

type CapabilitySource = {
  key: string | null;
  isExternalSend: boolean;
  recommendedPermission: string;
};

export function toolCapabilities(tool: CapabilitySource): Capability[] {
  if (!tool.key) return []; // metadata-only rows have no capabilities
  const toolName = tool.key.split(":")[1] ?? "";
  const caps = new Set<Capability>();
  // External write (the Chunk-16 classification) IS the send capability.
  if (tool.isExternalSend) caps.add("send");
  // Draft-shaped identity, or a draft-only permission profile that is not an
  // external write.
  if (/draft|compose/.test(toolName) || (tool.recommendedPermission === "draft_only" && !tool.isExternalSend)) {
    caps.add("draft");
  }
  // Read/lookup-shaped identity that is not an external write.
  if (!tool.isExternalSend && /search|find|lookup|query|browse|list|read|fetch/.test(toolName)) {
    caps.add("search");
  }
  return Array.from(caps);
}

// What the goal requires. The planner already reasons about this in prose
// (Rules 5/6); this is the server-side check that makes it a guarantee.
//
// Two tiers on purpose:
// - RESEARCH_GOAL (broad) drives the harmless read-only search AUTO-ATTACH —
//   adding least-privilege search to a summarize/brief goal costs nothing.
// - HARD_RESEARCH_GOAL (narrow: explicit research/lookup verbs) drives the HARD
//   requirement — a memory-only "summarize my notes" goal must stay plannable
//   with no tools at all when no search tool is connected.
export const RESEARCH_GOAL = /research|look ?up|find|search|summar|investigat|gather|news|compan|brief|report|discover|monitor|analy|compare/i;
const HARD_RESEARCH_GOAL = /\bresearch\b|\blook ?up\b|\bsearch\b|\binvestigat|\bdiscover\b|\bfind (?:out|the latest|new|current)\b/i;
const SEND_GOAL = /\bsend\b|\bemail\s+(?:me|it|them|us|him|her)\b|\bmail\s+(?:me|it)\b|\bdispatch\b|\bdeliver\b/i;
const DRAFT_GOAL = /\bdraft\b|\bcompose\b/i;

export function requiredCapabilities(goal: string): Capability[] {
  const required: Capability[] = [];
  if (HARD_RESEARCH_GOAL.test(goal)) required.push("search");
  if (SEND_GOAL.test(goal)) required.push("send");
  else if (DRAFT_GOAL.test(goal)) required.push("draft");
  return required;
}

export type CapabilityGap = {
  capability: Capability;
  // Whether the catalog COULD satisfy it (drives re-plan vs. actionable error).
  availableInCatalog: boolean;
  // Attachable canonical keys that carry the capability.
  candidates: string[];
  reason: string;
};

function catalogCandidates(snapshot: CatalogSnapshot, capability: Capability): CatalogSnapshotTool[] {
  return snapshot.tools.filter((t) => t.key && toolCapabilities(t).includes(capability));
}

// Which required capabilities the RESOLVED plan is missing. Generic over the
// catalog: driven entirely by derived tags.
export function missingCapabilities(
  plan: ResolvedFlow,
  snapshot: CatalogSnapshot,
  required: Capability[]
): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  for (const capability of required) {
    const has = plan.tools.some((tool) => toolCapabilities({ ...tool, key: tool.key }).includes(capability));
    if (has) continue;
    const candidates = catalogCandidates(snapshot, capability);
    gaps.push({
      capability,
      availableInCatalog: candidates.length > 0,
      candidates: candidates.map((t) => t.key as string),
      reason:
        candidates.length > 0
          ? `the goal requires a ${capability}-capable tool but the plan does not include one`
          : `this goal needs ${capability === "send" ? "email/message send" : capability}; no ${capability}-capable tool is available or connected — connect one first`
    });
  }
  return gaps;
}

// Rule-6 enforcement for send plans: a send-capable tool must be paired with an
// approval gate. The gate is auto-added (conservative, safety-increasing) after
// the final agent when missing — visible as a warning, never silent.
export function ensureSendGate(plan: ResolvedFlow, warnings: string[]): void {
  const hasSend = plan.tools.some((tool) => toolCapabilities(tool).includes("send"));
  if (!hasSend || plan.approvalGates.length > 0 || plan.agents.length === 0) return;
  const lastOrder = Math.max(...plan.agents.map((agent) => agent.order));
  plan.approvalGates.push({
    afterAgentOrder: lastOrder,
    trigger: "Before any external send executes",
    actionType: "email_send"
  });
  warnings.push("Approval gate auto-added before the send step (external sends are always approval-gated).");
}

// Draft creation is a reversible mailbox write, not a read. Keep that approval
// visible in the authored plan as well as enforcing it again at runtime.
export function ensureDraftGate(plan: ResolvedFlow, warnings: string[]): void {
  const hasDraft = plan.tools.some((tool) => toolCapabilities(tool).includes("draft"));
  if (!hasDraft || plan.approvalGates.length > 0 || plan.agents.length === 0) return;
  const lastOrder = Math.max(...plan.agents.map((agent) => agent.order));
  plan.approvalGates.push({
    afterAgentOrder: lastOrder,
    trigger: "Before the draft is written to the connected account",
    actionType: "email_draft"
  });
  warnings.push("Approval gate auto-added before draft creation (drafts write to the connected account).");
}

// A normal delivery goal chooses one terminal path: draft OR send. Attaching
// both made every workflow-scoped agent see both Gmail actions and produced a
// draft plus repeated sends. A separate draft-review stage remains possible only
// when the goal itself explicitly requires drafting (the caller passes both).
export function enforceSingleDeliveryPath(
  plan: ResolvedFlow,
  required: Capability[],
  warnings: string[]
): void {
  const needsSend = required.includes("send");
  const needsDraft = required.includes("draft");
  if (needsSend && !needsDraft && plan.tools.some((tool) => toolCapabilities(tool).includes("send"))) {
    const sendingServers = new Set(
      plan.tools
        .filter((tool) => toolCapabilities(tool).includes("send"))
        .map((tool) => tool.key.split(":")[0])
    );
    const before = plan.tools.length;
    plan.tools = plan.tools.filter((tool) =>
      !toolCapabilities(tool).includes("draft") || !sendingServers.has(tool.key.split(":")[0])
    );
    if (plan.tools.length !== before) {
      warnings.push("Removed the redundant draft tool because this goal uses one approval-gated send path.");
    }
  }
  if (needsDraft && !needsSend) {
    const before = plan.tools.length;
    plan.tools = plan.tools.filter((tool) => !toolCapabilities(tool).includes("send"));
    if (plan.tools.length !== before) {
      warnings.push("Removed the send tool because this goal requests a draft, not delivery.");
    }
  }
}
