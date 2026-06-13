// Pure layout for the Flow Graph (no React, no graph library). Turns a flow
// (planned, manual-canvas, or saved) into positioned nodes + edges. Reused by the
// Builder and the read-only Flows detail view.
import type { PlannedFlow } from "../../lib/orchestrator/schema";
import type { BuilderNode, McpRiskLevel, PersistedWorkflow } from "../../lib/types";

export type GraphTone = "accent" | "ok" | "warn" | "danger" | "restricted" | "neutral";
export type GraphKind = "goal" | "agent" | "tool" | "memory" | "gate";

export type GraphInput = {
  goal: string;
  agents: { id: string; name: string; subtitle?: string; order: number }[];
  tools: { id: string; name: string; subtitle?: string; tone: GraphTone }[];
  memory: { id: string; name: string; subtitle?: string }[];
  gates: { id: string; afterOrder: number; label: string }[];
};

export type PositionedNode = {
  id: string;
  kind: GraphKind;
  title: string;
  subtitle?: string;
  tone: GraphTone;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Edge = { id: string; d: string; tone: GraphTone };

export type GraphLayout = { nodes: PositionedNode[]; edges: Edge[]; width: number; height: number };

const NODE_W = 156;
const NODE_H = 60;
const GATE_W = 110;
const GAP_X = 32;
const GAP_Y = 56;

export function riskTone(risk: McpRiskLevel): GraphTone {
  return risk === "low" ? "ok" : risk === "medium" ? "warn" : risk === "high" ? "danger" : "restricted";
}

// Rounded-elbow path between two points (vertical-then-horizontal feel).
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2 || y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  const r = 8;
  const dir = x2 > x1 ? 1 : -1;
  return `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 + r * dir} ${midY} L ${x2 - r * dir} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
}

export function layoutFlow(input: GraphInput): GraphLayout {
  const agents = [...input.agents].sort((a, b) => a.order - b.order);

  // Build the spine sequence: goal, then each agent, inserting a gate after the
  // agent whose order it follows.
  type SpineItem = { node: PositionedNode };
  const spine: SpineItem[] = [];

  const memY = 0;
  const spineY = NODE_H + GAP_Y;
  const toolY = spineY + NODE_H + GAP_Y;

  let x = 0;
  const pushSpine = (node: Omit<PositionedNode, "x" | "y">) => {
    const w = node.w;
    spine.push({ node: { ...node, x, y: spineY } });
    x += w + GAP_X;
  };

  pushSpine({ id: "goal", kind: "goal", title: "Goal", subtitle: input.goal, tone: "neutral", w: NODE_W, h: NODE_H });

  for (const agent of agents) {
    pushSpine({ id: agent.id, kind: "agent", title: agent.name, subtitle: agent.subtitle, tone: "accent", w: NODE_W, h: NODE_H });
    const gate = input.gates.find((g) => g.afterOrder === agent.order);
    if (gate) {
      pushSpine({ id: gate.id, kind: "gate", title: "Approval gate", subtitle: gate.label, tone: "warn", w: GATE_W, h: NODE_H });
    }
  }

  const spineWidth = Math.max(x - GAP_X, NODE_W);
  const spineNodes = spine.map((s) => s.node);

  // Distribute tools / memory evenly across the spine width.
  const spread = (count: number, idx: number, w: number) => {
    if (count <= 1) return (spineWidth - w) / 2;
    return (idx * (spineWidth - w)) / (count - 1);
  };

  const toolNodes: PositionedNode[] = input.tools.map((t, i) => ({
    id: t.id, kind: "tool", title: t.name, subtitle: t.subtitle, tone: t.tone,
    x: spread(input.tools.length, i, NODE_W), y: toolY, w: NODE_W, h: NODE_H
  }));

  const memoryNodes: PositionedNode[] = input.memory.map((m, i) => ({
    id: m.id, kind: "memory", title: m.name, subtitle: m.subtitle, tone: "restricted",
    x: spread(input.memory.length, i, NODE_W), y: memY, w: NODE_W, h: NODE_H
  }));

  // Edges
  const edges: Edge[] = [];
  for (let i = 0; i < spineNodes.length - 1; i++) {
    const a = spineNodes[i];
    const b = spineNodes[i + 1];
    edges.push({
      id: `spine-${i}`,
      d: `M ${a.x + a.w} ${a.y + a.h / 2} L ${b.x} ${b.y + b.h / 2}`,
      tone: b.kind === "gate" ? "warn" : "neutral"
    });
  }
  // Memory drops down into the flow band; tools hang below it.
  for (const m of memoryNodes) {
    const cx = m.x + m.w / 2;
    edges.push({ id: `mem-${m.id}`, d: elbow(cx, m.y + m.h, cx, spineY), tone: "restricted" });
  }
  for (const t of toolNodes) {
    const cx = t.x + t.w / 2;
    edges.push({ id: `tool-${t.id}`, d: elbow(cx, t.y, cx, spineY + NODE_H), tone: t.tone });
  }

  const nodes = [...memoryNodes, ...spineNodes, ...toolNodes];
  return { nodes, edges, width: spineWidth, height: toolY + NODE_H };
}

// ---- Adapters from the three flow sources ----

export function plannedFlowToGraph(plan: PlannedFlow): GraphInput {
  return {
    goal: plan.goal,
    agents: plan.agents.map((a) => ({ id: `agent-${a.order}-${a.agentName}`, name: a.agentName, subtitle: a.role, order: a.order })),
    tools: plan.tools.map((t) => ({ id: `tool-${t.mcpServerId}`, name: t.displayName, subtitle: t.effectivePermission.replaceAll("_", " "), tone: riskTone(t.riskLevel) })),
    memory: plan.memoryAttachments.map((m) => ({ id: `mem-${m.partitionName}`, name: m.partitionName, subtitle: m.access.replaceAll("_", " ") })),
    gates: plan.approvalGates.map((g, i) => ({ id: `gate-${i}`, afterOrder: g.afterAgentOrder, label: g.actionType }))
  };
}

export function builderNodesToGraph(goal: string, nodes: BuilderNode[]): GraphInput {
  const agents = nodes.filter((n) => n.type === "agent");
  return {
    goal,
    agents: agents.map((n, i) => ({ id: n.id, name: n.name, subtitle: n.category ?? n.provider, order: i + 1 })),
    tools: nodes.filter((n) => n.type === "mcp").map((n) => ({
      id: n.id, name: n.name, subtitle: (n.riskLevel ?? "low") + " risk",
      tone: riskTone((n.riskLevel as McpRiskLevel) ?? "low")
    })),
    memory: nodes.filter((n) => n.type === "memory").map((n) => ({ id: n.id, name: n.name, subtitle: n.memoryAccess })),
    gates: nodes
      .filter((n) => n.type === "control")
      .map((n) => ({ id: n.id, afterOrder: agents.length, label: "approval" }))
  };
}

export function savedWorkflowToGraph(workflow: PersistedWorkflow): GraphInput {
  const agents = [...workflow.workflowAgents].sort((a, b) => a.routeOrder - b.routeOrder);
  const gated = workflow.approvalMode === "approval_gated" && agents.length > 0;
  return {
    goal: workflow.goal,
    agents: agents.map((wa) => ({ id: wa.id, name: wa.agent.name, subtitle: wa.roleInWorkflow, order: wa.routeOrder })),
    tools: (workflow.workflowMcps ?? []).map((wm) => ({
      id: wm.id, name: wm.mcpServer.displayName, subtitle: wm.defaultPermission.replaceAll("_", " "),
      tone: riskTone(wm.mcpServer.riskLevel)
    })),
    memory: [],
    gates: gated ? [{ id: "gate-last", afterOrder: agents[agents.length - 1].routeOrder, label: "before send" }] : []
  };
}
