"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { isTerminalRunStatus } from "../../lib/runs/terminal";

import {
  attachToolToFlow,
  killRealRun,
  listConnections,
  listDiscoveredTools,
  listFlows,
  removeToolGrant,
  resolveApproval,
  respondToIntent,
  startRealRun,
  type DiscoveredTool,
  type PersistedConnection
} from "../../lib/api/client";
import type { PersistedWorkflow } from "../../lib/types";
import { Badge, Button, EmptyState } from "../layout/primitives";
import { useToast } from "../layout/Toast";
import { Builder } from "../build/Builder";
import { ControlPlane } from "../control/ControlPlane";
import { ConnectPanel } from "../connect/ConnectPanel";
import { IntentSurface } from "./IntentSurface";
import { recommendedBuilderNodes } from "../mock-data";
import type { BuilderNode } from "../../lib/types";
import "./workspace.css";

// In-place drawers that expand below the always-visible flow surface — never a
// full-screen view swap. null = all collapsed.
type WorkspaceDrawer = "build" | "connect" | "activity";

type Participant = {
  agentId: string;
  agentName: string;
  role: string;
  order: number;
  tools: {
    serverId: string;
    serverName: string;
    toolName: string;
    isExternalSend: boolean;
    grantId: string;
    permission: string;
    revoked: boolean;
  }[];
};

type RunStep = { id: string; eventType: string; title: string; description: string; decision: string | null; costCents: number };

type RunState = {
  runId: string | null;
  status: string;
  output: string | null;
  steps: RunStep[];
  approvals: { id: string; title: string; description: string; status: string; intentType?: string | null; payload?: unknown }[];
  toolCallCount: number;
  stepCount: number;
  spentCents: number;
};

export function FlowWorkspace({
  flowId,
  onFlowChange
}: {
  flowId: string | null;
  onFlowChange?: (id: string | null) => void;
}) {
  const { data: session } = useSession();
  const toast = useToast();

  const [openDrawer, setOpenDrawer] = useState<WorkspaceDrawer | null>(null);
  const toggleDrawer = (d: WorkspaceDrawer) => setOpenDrawer((cur) => (cur === d ? null : d));

  // Builder state (moved in from page.tsx).
  const [builderPrompt, setBuilderPrompt] = useState("Describe an outcome…");
  const [builderNodes, setBuilderNodes] = useState<BuilderNode[]>([recommendedBuilderNodes[0]]);
  const [selectedBuilderNodeId, setSelectedBuilderNodeId] = useState(recommendedBuilderNodes[0].id);
  const [builderSaved, setBuilderSaved] = useState(false);

  const [flows, setFlows] = useState<PersistedWorkflow[]>([]);
  const [flow, setFlow] = useState<PersistedWorkflow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedP, setSelectedP] = useState<string | null>(null);
  // Which participant's inline "+ grant tool" picker is open (agentId), if any.
  const [grantPickerFor, setGrantPickerFor] = useState<string | null>(null);
  const [connections, setConnections] = useState<PersistedConnection[]>([]);
  const [availableTools, setAvailableTools] = useState<DiscoveredTool[]>([]);

  const [run, setRun] = useState<RunState>({ runId: null, status: "", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0, spentCents: 0 });
  // Server truth: a run is "running" until it reaches a terminal status. Derived
  // from the streamed status — never a local flag that can wedge on "Running…".
  const running = run.runId != null && run.status !== "" && !isTerminalRunStatus(run.status);

  // Describe-to-build
  const [describeText, setDescribeText] = useState("");
  const [planning, setPlanning] = useState(false);

  // Builder helpers
  const recommendBuilderStack = () => {
    setBuilderNodes(recommendedBuilderNodes);
    setSelectedBuilderNodeId("agent-job-discovery");
    setBuilderSaved(false);
  };
  const addBuilderNode = (node: BuilderNode) => {
    setBuilderNodes((cur) => {
      const uniqueId = `${node.id}-${cur.length + 1}`;
      const nextNode = cur.some((n) => n.id === node.id) ? { ...node, id: uniqueId } : node;
      setSelectedBuilderNodeId(nextNode.id);
      return [...cur, nextNode];
    });
    setBuilderSaved(false);
  };
  const removeBuilderNode = (id: string) => {
    setBuilderNodes((cur) => {
      const next = cur.filter((n) => n.id !== id || n.type === "goal");
      setSelectedBuilderNodeId(next[0]?.id ?? recommendedBuilderNodes[0].id);
      return next.length ? next : [recommendedBuilderNodes[0]];
    });
    setBuilderSaved(false);
  };
  const loadWorkflowNodes = (nodes: BuilderNode[]) => {
    if (!nodes.length) return;
    setBuilderNodes(nodes);
    setSelectedBuilderNodeId(nodes[0].id);
    setBuilderSaved(true);
  };

  const loadFlows = useCallback(async () => {
    if (!session?.user) return;
    try {
      const data = await listFlows();
      setFlows(data.workflows ?? []);
    } catch { /* mute */ }
  }, [session?.user]);

  const loadFlow = useCallback(async (id: string) => {
    try {
      const data = await listFlows();
      const f = (data.workflows ?? []).find((w) => w.id === id);
      if (!f) return;
      setFlow(f);

      // Build participants from workflow agents + their grants.
      const parts: Participant[] = (f.workflowAgents ?? []).map((wa) => {
        const grants = (f.mcpAccessGrants ?? []).filter(
          (g) => g.mcpServer?.mcpServerKey && g.mcpServer?.mcpToolName
        );
        return {
          agentId: wa.agent.id,
          agentName: wa.agent.name,
          role: wa.roleInWorkflow,
          order: wa.routeOrder,
          tools: grants.map((g) => ({
            serverId: g.mcpServer.id,
            serverName: g.mcpServer.name,
            toolName: g.mcpServer.mcpToolName ?? g.mcpServer.name,
            isExternalSend: g.mcpServer.isExternalSend ?? false,
            grantId: g.id,
            permission: g.requiresApproval ? "approval_required" : g.canWrite ? "draft_only" : "read_only",
            revoked: Boolean(g.revokedAt)
          }))
        };
      });
      setParticipants(parts);
      if (parts.length > 0) setSelectedP(parts[0].agentId);
    } catch { /* mute */ }
  }, []);

  const loadConnectionsAndTools = useCallback(async () => {
    if (!session?.user) return;
    try {
      const connData = await listConnections();
      const conns = connData.connections?.filter((c) => c.status === "discovered") ?? [];
      setConnections(conns);
      const all: DiscoveredTool[] = [];
      for (const c of conns) {
        try {
          const td = await listDiscoveredTools(c.id);
          all.push(...(td.tools ?? []));
        } catch { /* skip */ }
      }
      setAvailableTools(all);
    } catch { /* mute */ }
  }, [session?.user]);

  useEffect(() => { loadFlows(); loadConnectionsAndTools(); }, [loadFlows, loadConnectionsAndTools]);
  useEffect(() => { if (flowId) loadFlow(flowId); }, [flowId, loadFlow]);
  // Closing a drawer is when state may have changed under it — refresh the
  // grantable tool list (connect drawer) and the flow itself (build canvas may
  // have rewired participants) so the always-visible surface stays current.
  useEffect(() => {
    if (openDrawer === null) {
      loadConnectionsAndTools();
      if (flowId) loadFlow(flowId);
    }
  }, [openDrawer, flowId, loadConnectionsAndTools, loadFlow]);

  // --- Run: live SSE truth (no polling) ---
  // Subscribe to the run's event stream, keyed on runId. One subscription per
  // run; the browser's EventSource reconnects on a blip (the server re-sends
  // everything, deduped by event id here), and we close it on any terminal
  // status so the stream never outlives the run.
  const terminalToastedRef = useRef<string | null>(null);
  useEffect(() => {
    const runId = run.runId;
    if (!runId) return;
    const es = new EventSource(`/api/runs/${runId}/stream`);

    es.onmessage = (msg) => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(msg.data); } catch { return; }

      if (data.type === "run_snapshot") {
        setRun((prev) => prev.runId !== runId ? prev : {
          ...prev,
          status: String(data.status ?? prev.status),
          output: (data.resultText as string | null) ?? prev.output,
          approvals: (data.approvals as RunState["approvals"]) ?? [],
          toolCallCount: Number(data.toolCallCount ?? prev.toolCallCount),
          stepCount: Number(data.stepCount ?? prev.stepCount),
          spentCents: Number(data.totalCostCents ?? prev.spentCents)
        });
        return;
      }

      if (data.type === "run_terminal") {
        const status = String(data.status);
        setRun((prev) => prev.runId !== runId ? prev : { ...prev, status });
        if (terminalToastedRef.current !== runId) {
          terminalToastedRef.current = runId;
          toast(status === "completed" ? "Run complete." : `Run ended: ${status}`, status === "completed" ? "ok" : "warn");
        }
        es.close(); // never let a terminal run keep a stream open / auto-reconnect
        return;
      }

      // Otherwise it's a WorkflowRunEvent row — upsert into the step list by id.
      if (typeof data.id === "string") {
        const step: RunStep = {
          id: data.id,
          eventType: String(data.eventType ?? ""),
          title: String(data.title ?? ""),
          description: String(data.description ?? ""),
          decision: (data.decision as string | null) ?? null,
          costCents: Number(data.costCents ?? 0)
        };
        setRun((prev) => {
          if (prev.runId !== runId) return prev;
          const exists = prev.steps.some((s) => s.id === step.id);
          return { ...prev, steps: exists ? prev.steps.map((s) => (s.id === step.id ? step : s)) : [...prev.steps, step] };
        });
      }
    };

    return () => { es.close(); };
  }, [run.runId, toast]);

  const handleRun = async () => {
    if (!flowId) return toast("Select a flow first.", "warn");

    // Pre-flight: warn if no tools are granted to any agent.
    const totalGrants = participants.reduce((sum, p) => sum + p.tools.filter((t) => !t.revoked).length, 0);
    if (totalGrants === 0) {
      return toast("This flow has no tools granted. Agents can only produce text — they cannot search, draft, or send. Grant tools from the right panel first.", "warn");
    }

    try {
      terminalToastedRef.current = null;
      const result = await startRealRun(flowId);
      // Set runId → the effect above subscribes to the live stream from here.
      setRun({ runId: result.run.runId, status: result.run.status || "queued", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0, spentCents: 0 });
      toast("Run queued. Streaming live…", "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Run failed.", "danger");
    }
  };

  const handleKill = async () => {
    if (!run.runId) return;
    try {
      await killRealRun(run.runId);
      toast("Run killed.", "warn");
      // The stream reports the killed status and closes itself.
    } catch (error) {
      toast(error instanceof Error ? error.message : "Kill failed.", "danger");
    }
  };

  const handleApprove = async (approvalId: string, approved: boolean) => {
    try {
      await resolveApproval(approvalId, approved ? "approved" : "denied");
      // Optimistically clear the card; the same live stream reports the resumed
      // run — no new subscription, no stacked pollers.
      setRun((prev) => ({ ...prev, approvals: prev.approvals.filter((a) => a.id !== approvalId) }));
      toast(approved ? "Approved — resuming…" : "Denied — run halted.", approved ? "ok" : "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Approval failed.", "danger");
    }
  };

  const handleRespond = async (intentId: string, response: Record<string, unknown>) => {
    try {
      await respondToIntent(intentId, response);
      setRun((prev) => ({ ...prev, approvals: prev.approvals.filter((a) => a.id !== intentId) }));
      toast("Response sent — resuming…", "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not submit your response.", "danger");
    }
  };

  // --- Grant ---
  const handleGrant = async (participant: Participant, tool: DiscoveredTool) => {
    if (!flowId) return;
    try {
      await attachToolToFlow(flowId, {
        mcpServerId: tool.serverRowId,
        purpose: `${tool.displayName} for ${participant.agentName}`,
        defaultPermission: tool.isExternalSend ? "approval_required" : "draft_only"
      });
      toast(`Granted ${tool.toolName} to ${participant.agentName}.`, "ok");
      if (flowId) loadFlow(flowId);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Grant failed.", "danger");
    }
  };

  const handleRevoke = async (participant: Participant, toolServerId: string) => {
    if (!flowId) return;
    try {
      await removeToolGrant(flowId, toolServerId);
      toast(`Revoked tool from ${participant.agentName}.`, "ok");
      if (flowId) loadFlow(flowId);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Revoke failed.", "danger");
    }
  };

  // --- Describe-to-build ---
  const handleDescribe = async () => {
    if (!describeText.trim()) return toast("Describe what you want done first.", "warn");
    setPlanning(true);
    try {
      const { planFlow } = await import("../../lib/api/client");
      const { planToSaveInput } = await import("../../lib/orchestrator/convert");
      const { saveFlow } = await import("../../lib/api/client");
      const data = await planFlow(describeText);
      const saveResult = await saveFlow(planToSaveInput(data.plan), "Flow save failed.");
      toast("Flow planned and saved. Opening it now.", "ok");
      await loadFlows();
      if (onFlowChange) onFlowChange(saveResult.workflow?.id ?? null);
      if (saveResult.workflow?.id) loadFlow(saveResult.workflow.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Planning failed.", "danger");
    } finally {
      setPlanning(false);
    }
  };

  // --- Derive ---
  const grantedToolIds = new Set(participants.flatMap((p) => p.tools.map((t) => t.serverId)));
  // Permission state shown on each granted tool: external-write needs approval,
  // everything else is allowed outright.
  const permView = (permission: string) =>
    permission === "approval_required"
      ? { icon: "⚠", label: "approval", kind: "approval" }
      : { icon: "✓", label: permission.replaceAll("_", " "), kind: "allowed" };

  if (!session?.user) {
    return <EmptyState icon={<span style={{ fontSize: 28 }}>🔐</span>} title="Sign in to use the workspace" body="Sign in with Google to build, grant, run, and watch your flows." />;
  }

  const spend = run.spentCents / 100;
  const cap = (flow?.maxRunBudgetCents ?? 0) / 100;

  return (
    <div className="wsShell">
      {/* FULL-WIDTH RUN HEADER — flow selector + run controls + spend, always visible */}
      <header className="wsHeader">
        <div className="wsHeaderMain">
          <select
            className="wsFlowSelect"
            aria-label="Select flow"
            value={flowId ?? ""}
            onChange={(e) => { if (onFlowChange) onFlowChange(e.target.value || null); if (e.target.value) loadFlow(e.target.value); }}
          >
            <option value="">Select a flow…</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {flow && <span className="wsFlowName">{flow.name}</span>}
        </div>
        <div className="wsHeaderControls">
          {flow && (
            <>
              <Button variant="primary" size="sm" loading={running} onClick={handleRun} disabled={running}>
                {running ? "Running…" : "▶ Run"}
              </Button>
              {running && <Button variant="danger" size="sm" onClick={handleKill}>■ Kill</Button>}
              <span className="wsHeaderMeta">
                spend ${spend.toFixed(2)}{cap ? ` / $${cap.toFixed(2)}` : ""} · {participants.length} participant{participants.length !== 1 ? "s" : ""}
                {run.status && (
                  <> · <span style={{ color: run.status === "completed" ? "var(--ok)" : run.status.includes("halted") ? "var(--danger)" : "var(--muted)" }}>{run.status}</span></>
                )}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="workspaceRoot">
      {/* LEFT: Flows list + Participants */}
      <div className="workspaceLeft">
        <div className="describeBar">
          <input
            className="describeInput"
            placeholder="Describe what you want done…"
            value={describeText}
            onChange={(e) => setDescribeText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDescribe()}
          />
          <Button variant="primary" size="sm" loading={planning} onClick={handleDescribe}>
            Plan
          </Button>
        </div>

        <div className="participantsHead">
          <h2>Participants</h2>
          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{participants.length} agent{participants.length !== 1 ? "s" : ""}</span>
        </div>

        {participants.map((p) => {
          const activeTools = p.tools.filter((t) => !t.revoked);
          const pickerOpen = grantPickerFor === p.agentId;
          const ungranted = availableTools.filter((t) => !grantedToolIds.has(t.serverRowId));
          return (
            <div
              className="participantCard"
              key={p.agentId}
              data-selected={selectedP === p.agentId}
              onClick={() => setSelectedP(p.agentId)}
            >
              <div className="participantCardTop">
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span className="participantOrder">{p.order}</span>
                  <strong>{p.agentName}</strong>
                </div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.2rem" }}>{p.role}</div>

              {/* Grants live on the participant — permission state inline */}
              <div className="pGrants">
                {activeTools.length === 0 && <div className="pGrantEmpty">· no tools granted</div>}
                {activeTools.map((t) => {
                  const v = permView(t.permission);
                  return (
                    <div className="pGrantRow" key={t.serverId}>
                      <span className="pGrantPerm" data-kind={v.kind}>{v.icon}</span>
                      <span className="pGrantName">{t.toolName}</span>
                      <span className="pGrantState">{v.label}</span>
                      <button
                        className="pGrantRevoke"
                        title="Revoke"
                        onClick={(e) => { e.stopPropagation(); handleRevoke(p, t.serverId); }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* + grant tool — opens an inline picker in place, no navigation */}
              <button
                className="pGrantAdd"
                onClick={(e) => { e.stopPropagation(); setSelectedP(p.agentId); setGrantPickerFor(pickerOpen ? null : p.agentId); }}
              >
                {pickerOpen ? "× close" : "+ grant tool"}
              </button>

              {pickerOpen && (
                <div className="pGrantPicker" onClick={(e) => e.stopPropagation()}>
                  {ungranted.length === 0 ? (
                    <div className="pGrantPickerEmpty">
                      No discovered tools to grant.{" "}
                      <button className="pGrantPickerLink" onClick={() => setOpenDrawer("connect")}>Connect a server →</button>
                    </div>
                  ) : (
                    ungranted.slice(0, 12).map((t) => (
                      <button
                        className="pGrantPickerItem"
                        key={t.serverRowId}
                        onClick={() => { handleGrant(p, t); setGrantPickerFor(null); }}
                      >
                        <span className="pGrantPickerName">{t.toolName}</span>
                        <Badge risk={t.isExternalSend ? "high" : "low"} />
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Blast-radius mini stays on the participant (expands when selected) */}
              {selectedP === p.agentId && (
                <div className="pBlast" onClick={(e) => e.stopPropagation()}>
                  <div className="pBlastHead">blast radius</div>
                  <div className="radarContainer">
                    {["Read/Search", "Drafts", "External Send", "Memory Access"].map((cap) => {
                      const level = cap === "External Send" ? 1 : cap === "Drafts" ? 2 : cap === "Read/Search" ? 3 : 2;
                      return (
                        <div className="radarAxis" key={cap}>
                          <span className="radarAxisLabel">{cap}</span>
                          <div className="radarAxisTrack">
                            <div className="radarAxisFill" data-level={String(level)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="pBlastNote">External-write always requires approval at run time.</p>
                </div>
              )}
            </div>
          );
        })}

        {/* Edit structure in place — expands the build canvas drawer, never a swap */}
        <button
          className="participantsAddStep"
          onClick={() => setOpenDrawer(openDrawer === "build" ? null : "build")}
        >
          ✎ {participants.length ? "Edit graph / add a step" : "Build a flow on the canvas"}
        </button>
      </div>

      {/* CENTER: This run (output + live process + inline approval) */}
      <div className="workspaceCenter">
        {flow ? (
          <>
            <div className="runColHead">
              <h2>This run</h2>
              {run.status && (
                <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                  {run.toolCallCount} tools · {run.stepCount} model steps
                </span>
              )}
            </div>

            {/* --- TOOL SETUP GUIDE — shown when no tools are connected or granted --- */}
            {availableTools.length === 0 && participants.every((p) => p.tools.filter((t) => !t.revoked).length === 0) && (
              <div style={{
                background: "var(--surface-elevated)",
                border: "1px dashed var(--border)",
                borderRadius: "var(--radius-lg, 8px)",
                padding: "1rem 1.25rem",
                marginBottom: "0.75rem"
              }}>
                <strong style={{ fontSize: "0.85rem" }}>🔌 Set up tools for this flow</strong>
                <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.4rem 0", lineHeight: 1.5 }}>
                  Your agents need tools to act. Without tools, they can only produce text — no search, no email, no actions.
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <Button variant="secondary" size="sm" onClick={() => setOpenDrawer("connect")}>
                    1. Connect a server
                  </Button>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)", alignSelf: "center" }}>→</span>
                  <Button variant="secondary" size="sm" onClick={() => setOpenDrawer("connect")}>
                    2. Discover tools
                  </Button>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)", alignSelf: "center" }}>→</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", alignSelf: "center" }}>
                    3. Grant tools to agents →
                  </span>
                </div>
              </div>
            )}

            {/* --- INTERACTION SURFACES — the agent is asking you (choice/form/
                 confirmation) or requesting approval. One constrained renderer. --- */}
            {run.approvals.length > 0 && (
              <div className="intentStack">
                {run.approvals.map((a) => (
                  <IntentSurface
                    key={a.id}
                    intent={a}
                    onRespond={handleRespond}
                    onResolveApproval={handleApprove}
                  />
                ))}
              </div>
            )}

            {run.output ? (
              <div className="runOutput">{run.output}</div>
            ) : run.status === "paused_for_approval" && run.approvals.length === 0 ? (
              <div className="runOutput">
                <div className="runOutputEmpty">
                  Approval resolved — waiting for the worker to resume…
                </div>
              </div>
            ) : run.steps.length > 0 ? (
              <div className="runOutput">
                <div className="runSteps">
                  {run.steps.map((s, i) => (
                    <div className="runStep" key={i}>
                      <span className="runStepIcon">
                        {s.decision === "blocked" ? "🚫" : s.decision === "approval_required" ? "⏸" : s.decision === "allowed" ? "✅" : "·"}
                      </span>
                      <div className="runStepBody">
                        <div>{s.title}</div>
                        <div className="runStepMeta">{s.description.slice(0, 140)}</div>
                        {s.decision === "blocked" && flowId && !s.title.startsWith("Already executed:") && (
                          <div style={{ marginTop: "0.25rem" }}>
                            <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>
                              Grant this tool to unblock — use the Grants panel on the right →
                            </span>
                          </div>
                        )}
                        {s.decision === "approval_required" && (
                          <div style={{ marginTop: "0.25rem" }}>
                            <span style={{ fontSize: "0.65rem", color: "var(--warn)" }}>
                              ↳ Resolve this in the approval box above
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="runOutput">
                <div className="runOutputEmpty">
                  {running ? "Waiting for the worker…" : "Press ▶ Run to execute this flow."}
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>◎</span>}
            title="Select or describe a flow"
            body="Pick a saved flow from the dropdown, or describe one above and press Plan."
          />
        )}
      </div>

      </div>

      {/* BOTTOM DRAWERS — heavy sub-tasks expand in place; they never replace the
          flow surface, so you never lose sight of the flow to do a sub-task. */}
      <div className="wsDrawers">
        <div className="wsDrawerTabs">
          <button className="wsDrawerTab" data-active={openDrawer === "build"} onClick={() => toggleDrawer("build")}>
            {openDrawer === "build" ? "⌃" : "⌄"} Build canvas
          </button>
          <button className="wsDrawerTab" data-active={openDrawer === "connect"} onClick={() => toggleDrawer("connect")}>
            {openDrawer === "connect" ? "⌃" : "⌄"} Connect a server
          </button>
          <button className="wsDrawerTab" data-active={openDrawer === "activity"} onClick={() => toggleDrawer("activity")}>
            {openDrawer === "activity" ? "⌃" : "⌄"} Activity
          </button>
        </div>
        {openDrawer === "build" && (
          <div className="wsDrawerPanel">
            <Builder
              prompt={builderPrompt}
              setPrompt={setBuilderPrompt}
              nodes={builderNodes}
              selectedNodeId={selectedBuilderNodeId}
              setSelectedNodeId={setSelectedBuilderNodeId}
              saved={builderSaved}
              onRecommend={recommendBuilderStack}
              onAddNode={addBuilderNode}
              onRemoveNode={removeBuilderNode}
              onLoadWorkflow={loadWorkflowNodes}
              onSave={() => setBuilderSaved(true)}
              onViewLogs={() => setOpenDrawer("activity")}
              onSetDefault={() => {}}
              activeFlowId={flowId}
            />
          </div>
        )}
        {openDrawer === "connect" && (
          <div className="wsDrawerPanel"><ConnectPanel /></div>
        )}
        {openDrawer === "activity" && (
          <div className="wsDrawerPanel"><ControlPlane /></div>
        )}
      </div>
    </div>
  );
}
