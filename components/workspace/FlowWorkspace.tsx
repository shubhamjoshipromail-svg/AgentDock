"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { isTerminalRunStatus } from "../../lib/runs/terminal";
import type { ResolutionReport } from "../../lib/orchestrator/schema";

import {
  archiveFlow,
  attachToolToFlow,
  killRealRun,
  listConnections,
  listDiscoveredTools,
  listFlows,
  newIdempotencyKey,
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
import { useAttention } from "../attention/AttentionCenter";
import { isRichIntent } from "../../lib/attention/pending";
import { recommendedBuilderNodes } from "../mock-data";
import type { BuilderNode } from "../../lib/types";
import "./workspace.css";

// In-place drawers that expand below the always-visible flow surface — never a
// full-screen view swap. null = all collapsed.
type WorkspaceDrawer = "build" | "connect" | "activity";

// The guided first-run starter goal. Deliberately research-then-DRAFT (never
// send): it works under the draft-only default a new user starts with, and it
// exercises the real spine end-to-end — plan → run → approval-gated draft →
// deliverable → audit — with no simulated steps.
const STARTER_GOAL =
  "Research three current trends in AI agent infrastructure and draft an email to me summarizing them.";

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
  // Keep the global attention surface honest: any intent-lifecycle change seen
  // by this run's stream re-reads the ONE pending-intents state (debounced).
  const { refresh: refreshAttention, open: openIntentWindow } = useAttention();

  const [openDrawer, setOpenDrawer] = useState<WorkspaceDrawer | null>(null);
  const toggleDrawer = (d: WorkspaceDrawer) => setOpenDrawer((cur) => (cur === d ? null : d));

  // Builder graph state (moved in from page.tsx). The planner goal itself lives
  // in describeText below so the workspace and open Build drawer cannot drift.
  const [builderNodes, setBuilderNodes] = useState<BuilderNode[]>([recommendedBuilderNodes[0]]);
  const [selectedBuilderNodeId, setSelectedBuilderNodeId] = useState(recommendedBuilderNodes[0].id);
  const [builderSaved, setBuilderSaved] = useState(false);

  const [flows, setFlows] = useState<PersistedWorkflow[]>([]);
  const [flow, setFlow] = useState<PersistedWorkflow | null>(null);
  const [archivingFlow, setArchivingFlow] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedP, setSelectedP] = useState<string | null>(null);
  // Which participant's inline "+ grant tool" picker is open (agentId), if any.
  const [grantPickerFor, setGrantPickerFor] = useState<string | null>(null);
  const [connections, setConnections] = useState<PersistedConnection[]>([]);
  const [availableTools, setAvailableTools] = useState<DiscoveredTool[]>([]);

  const [run, setRun] = useState<RunState>({ runId: null, status: "", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0, spentCents: 0 });
  const [startingRun, setStartingRun] = useState(false);
  const runStartInFlightRef = useRef(false);
  // Server truth: a run is "running" until it reaches a terminal status. Derived
  // from the streamed status — never a local flag that can wedge on "Running…".
  const running = startingRun || (run.runId != null && run.status !== "" && !isTerminalRunStatus(run.status));

  // Describe-to-build
  const [describeText, setDescribeText] = useState("");
  const [planning, setPlanning] = useState(false);
  const planStartInFlightRef = useRef(false);
  // The resolution report from the last plan: what was attached, clamped, or
  // FAILED to resolve — shown before anything saves, never a footnote.
  const [planReport, setPlanReport] = useState<ResolutionReport | null>(null);

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
        refreshAttention();
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
  }, [run.runId, toast, refreshAttention]);

  const handleRun = async () => {
    if (!flowId) return toast("Select a flow first.", "warn");

    // Pre-flight: warn if no tools are granted to any agent.
    const totalGrants = participants.reduce((sum, p) => sum + p.tools.filter((t) => !t.revoked).length, 0);
    if (totalGrants === 0) {
      return toast("This flow has no tools granted. Agents can only produce text — they cannot search, draft, or send. Grant tools from the right panel first.", "warn");
    }
    if (runStartInFlightRef.current) return;

    runStartInFlightRef.current = true;
    const idempotencyKey = newIdempotencyKey();
    setStartingRun(true);
    try {
      terminalToastedRef.current = null;
      const result = await startRealRun(flowId, "Unable to start run.", idempotencyKey);
      // Set runId → the effect above subscribes to the live stream from here.
      setRun({ runId: result.run.runId, status: result.run.status || "queued", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0, spentCents: 0 });
      toast("Run queued. Streaming live…", "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Run failed.", "danger");
    } finally {
      runStartInFlightRef.current = false;
      setStartingRun(false);
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

  const handleArchiveFlow = async () => {
    if (!flowId || !flow) return;
    if (!window.confirm(`Archive “${flow.name}”? Its run history and audit trail will be preserved.`)) return;

    setArchivingFlow(true);
    try {
      await archiveFlow(flowId);
      setFlows((current) => current.filter((item) => item.id !== flowId));
      setFlow(null);
      setParticipants([]);
      setSelectedP(null);
      setRun({ runId: null, status: "", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0, spentCents: 0 });
      onFlowChange?.(null);
      toast("Flow archived. Its run history is still available in Activity.", "ok");
      await loadFlows();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to archive flow.", "danger");
    } finally {
      setArchivingFlow(false);
    }
  };

  const handleApprove = async (approvalId: string, approved: boolean) => {
    try {
      await resolveApproval(approvalId, approved ? "approved" : "denied");
      // Optimistically clear the card; the same live stream reports the resumed
      // run — no new subscription, no stacked pollers.
      setRun((prev) => ({ ...prev, approvals: prev.approvals.filter((a) => a.id !== approvalId) }));
      refreshAttention();
      toast(approved ? "Approved — resuming…" : "Denied — run halted.", approved ? "ok" : "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Approval failed.", "danger");
    }
  };

  const handleRespond = async (intentId: string, response: Record<string, unknown>) => {
    try {
      await respondToIntent(intentId, response);
      setRun((prev) => ({ ...prev, approvals: prev.approvals.filter((a) => a.id !== intentId) }));
      refreshAttention();
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
  // Accepts an optional explicit goal (used by the guided first-run starter) so a
  // one-click starter drives the SAME real plan→save path as typing a goal — no
  // separate/simulated onboarding flow.
  const handleDescribe = async (goalText?: string) => {
    const goal = (goalText ?? describeText).trim();
    if (!goal) return toast("Describe what you want done first.", "warn");
    if (planStartInFlightRef.current) return;
    if (goalText !== undefined) setDescribeText(goalText);
    planStartInFlightRef.current = true;
    const idempotencyKey = newIdempotencyKey();
    setPlanning(true);
    setPlanReport(null);
    try {
      const { planFlow } = await import("../../lib/api/client");
      const { planToSaveInput } = await import("../../lib/orchestrator/convert");
      const { saveFlow } = await import("../../lib/api/client");
      const data = await planFlow(goal, "Unable to plan this Flow.", idempotencyKey);
      const report = data.report ?? { attached: [], clamped: [], failed: [], replanned: false };
      setPlanReport(report);

      // No silent drops: unresolved references block the save, loudly.
      if (report.failed.length > 0) {
        toast(`Plan has ${report.failed.length} unresolved reference${report.failed.length > 1 ? "s" : ""} — review before saving.`, "danger");
        return;
      }
      if (data.plan.agents.length === 0) {
        toast("The plan resolved zero agents — nothing to save. Rephrase your goal.", "danger");
        return;
      }
      const saveResult = await saveFlow(planToSaveInput(data.plan), "Flow save failed.", idempotencyKey);
      const skipped = [
        ...(saveResult.skippedAgents ?? []),
        ...(saveResult.skippedTools ?? []),
        ...((saveResult as { skippedMemory?: string[] }).skippedMemory ?? [])
      ];
      if (skipped.length > 0) {
        // A partial save is an error the user must see — never a footnote.
        toast(`Saved, but ${skipped.length} reference${skipped.length > 1 ? "s were" : " was"} skipped: ${skipped.join(", ")}. Review before running.`, "danger");
      } else {
        toast("Flow planned and saved. Opening it now.", "ok");
      }
      await loadFlows();
      if (onFlowChange) onFlowChange(saveResult.workflow?.id ?? null);
      if (saveResult.workflow?.id) loadFlow(saveResult.workflow.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Planning failed.", "danger");
    } finally {
      planStartInFlightRef.current = false;
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
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {(f.workflowAgents?.length ?? 0) === 0 ? `⚠ ${f.name} (needs re-plan)` : f.name}
              </option>
            ))}
          </select>
          {flow && (
            <>
              <span className="wsFlowName">{flow.name}</span>
              <Button variant="ghost" size="sm" title="Archive flow" loading={archivingFlow} disabled={running} onClick={handleArchiveFlow}>
                Archive
              </Button>
            </>
          )}
        </div>
        <div className="wsHeaderControls">
          {flow && (
            <>
              {/* STATUS BAR: state chip + slim spend meter + the one primary and
                  one destructive action. Semantic colors are the loud element. */}
              {run.status && (
                <span
                  className="wsStateChip"
                  data-state={
                    run.status === "completed" ? "ok"
                      : run.status.includes("halted") || run.status === "killed" ? "danger"
                        : run.status === "paused_for_approval" ? "warn"
                          : "active"
                  }
                >
                  <span className="wsStateDot" aria-hidden />
                  {run.status.replaceAll("_", " ")}
                </span>
              )}
              <span className="wsSpend" title={`Spend this run${cap ? ` (cap $${cap.toFixed(2)})` : ""}`}>
                <span className="wsSpendBar" aria-hidden>
                  <span
                    className="wsSpendFill"
                    data-hot={cap > 0 && spend / cap > 0.8}
                    style={{ width: cap > 0 ? `${Math.min(100, (spend / cap) * 100)}%` : "0%" }}
                  />
                </span>
                <span className="data">${spend.toFixed(2)}{cap ? ` / $${cap.toFixed(2)}` : ""}</span>
              </span>
              <span className="wsHeaderMeta">
                {participants.length} participant{participants.length !== 1 ? "s" : ""}
              </span>
              <Button variant="primary" size="sm" loading={running} onClick={handleRun} disabled={running}>
                {running ? "Running…" : "▶ Run"}
              </Button>
              {running && <Button variant="danger" size="sm" onClick={handleKill}>■ Kill</Button>}
            </>
          )}
        </div>
      </header>

      <div className="workspaceRoot">
      {/* LEFT: Flows list + Participants */}
      <div className="workspaceLeft">
        {openDrawer !== "build" && (
          <div className="describeBar">
            <input
              className="describeInput"
              placeholder="Describe what you want done…"
              value={describeText}
              onChange={(e) => setDescribeText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDescribe()}
            />
            <Button variant="primary" size="sm" loading={planning} onClick={() => handleDescribe()}>
              Plan
            </Button>
          </div>
        )}

        <div className="participantsHead">
          <h2>Participants</h2>
          <span className="participantsCount">{participants.length} agent{participants.length !== 1 ? "s" : ""}</span>
        </div>

        {/* REPAIR STATE: a zero-agent flow (saved by the old buggy plan path)
            can never run — say so and offer the repair, not a mystery error. */}
        {flow && participants.length === 0 && (
          <div className="flowRepair">
            <strong>⚠ This flow has no agents — it needs a re-plan.</strong>
            <p>It was saved from a failed plan and can never run. Describe the goal again above (Plan), or add agents on the build canvas.</p>
            <Button variant="secondary" size="sm" onClick={() => { setDescribeText(flow.goal ?? ""); setOpenDrawer(null); }}>
              ↺ Re-plan from this goal
            </Button>
          </div>
        )}

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
                <div className="participantName">
                  <span className="participantOrder">{p.order}</span>
                  <strong>{p.agentName}</strong>
                </div>
              </div>
              <div className="participantRole">{p.role}</div>

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
        {/* PLAN RESOLUTION REPORT — attached / clamped / FAILED, before saving.
            Failures are prominent errors, never a footnote; a failed plan does
            not save. */}
        {planReport && (planReport.failed.length > 0 || planReport.clamped.length > 0) && (
          <div className="planReport" data-failed={planReport.failed.length > 0}>
            <div className="planReportHead">
              {planReport.failed.length > 0
                ? `⚠ Plan not saved — ${planReport.failed.length} reference${planReport.failed.length > 1 ? "s" : ""} could not be resolved${planReport.replanned ? " (after an automatic re-plan)" : ""}`
                : "Plan adjustments"}
              <button className="planReportClose" onClick={() => setPlanReport(null)}>×</button>
            </div>
            {planReport.failed.map((f, i) => (
              <div className="planReportRow" data-kind="failed" key={`f-${i}`}>
                <strong>{f.kind}</strong> “{f.asked}” — {f.reason}
                {f.closestMatches.length > 0 && <span className="planReportHint"> Did you mean: {f.closestMatches.join(", ")}?</span>}
              </div>
            ))}
            {planReport.clamped.map((c, i) => (
              <div className="planReportRow" data-kind="clamped" key={`c-${i}`}>{c}</div>
            ))}
            {planReport.attached.length > 0 && (
              <div className="planReportRow" data-kind="attached">
                Attached: {planReport.attached.map((a) => a.name).join(", ")}
              </div>
            )}
          </div>
        )}
        {flow ? (
          <>
            <div className="runColHead">
              <h2>This run</h2>
              {run.status && (
                <span className="runColMeta data">
                  {run.toolCallCount} tools · {run.stepCount} model steps
                </span>
              )}
            </div>

            {/* --- TOOL SETUP GUIDE — an empty state that teaches the next action --- */}
            {availableTools.length === 0 && participants.every((p) => p.tools.filter((t) => !t.revoked).length === 0) && (
              <div className="wsSetupGuide">
                <strong>🔌 Set up tools for this flow</strong>
                <p>Your agents need tools to act. Without tools, they can only produce text — no search, no email, no actions.</p>
                <div className="wsSetupSteps">
                  <Button variant="secondary" size="sm" onClick={() => setOpenDrawer("connect")}>
                    1. Connect a server
                  </Button>
                  <span aria-hidden>→</span>
                  <Button variant="secondary" size="sm" onClick={() => setOpenDrawer("connect")}>
                    2. Discover tools
                  </Button>
                  <span aria-hidden>→</span>
                  <span>3. Grant tools to agents</span>
                </div>
              </div>
            )}

            {/* --- INTERACTION SURFACES — the agent is asking you (choice/form/
                 confirmation) or requesting approval. One constrained renderer. --- */}
            {run.approvals.length > 0 && (
              <div className="intentStack">
                {run.approvals.map((a) =>
                  isRichIntent(a.intentType) ? (
                    // Rich surfaces (choice grids, forms) are cramped in this
                    // column — the timeline keeps a glanceable chip; answering
                    // happens in the focused window, with room to breathe.
                    <div className="intentChip" key={a.id}>
                      <span className="intentChipKind">⏸ waiting on you</span>
                      <span className="intentChipLabel">{a.title}</span>
                      <button className="intentChipOpen" onClick={() => openIntentWindow(a.id)}>Open</button>
                    </div>
                  ) : (
                    // Simple approvals stay one-click inline — quick-action and
                    // the focused window are complements, not duplicates.
                    <IntentSurface
                      key={a.id}
                      intent={a}
                      onRespond={handleRespond}
                      onResolveApproval={handleApprove}
                    />
                  )
                )}
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
                {/* THE TIMELINE: a connected step rail — semantic markers on a
                    vertical line, cost ticks in mono, entries animate in as
                    they stream. */}
                <div className="runSteps" data-rail>
                  {run.steps.map((s, i) => (
                    <div
                      className="runStep"
                      key={i}
                      data-decision={s.decision ?? "none"}
                    >
                      <span className="runStepMarker" aria-hidden>
                        {s.decision === "blocked" ? "✕" : s.decision === "approval_required" ? "⏸" : s.decision === "allowed" ? "✓" : "·"}
                      </span>
                      <div className="runStepBody">
                        <div className="runStepTitleRow">
                          <span className="runStepTitle">{s.title}</span>
                          {s.costCents > 0 && <span className="runStepCost data">${(s.costCents / 100).toFixed(2)}</span>}
                        </div>
                        <div className="runStepMeta">{s.description.slice(0, 140)}</div>
                        {s.decision === "blocked" && flowId && !s.title.startsWith("Already executed:") && (
                          <div className="runStepHint">Grant this tool to unblock — use the Grants panel on the left ←</div>
                        )}
                        {s.decision === "approval_required" && (
                          <div className="runStepHint" data-tone="warn">↳ Resolve this in the approval box above</div>
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
        ) : flows.length === 0 ? (
          /* GUIDED FIRST RUN — a brand-new user (no saved flows). Three real
             steps to first value, driving the actual engine (no simulation). */
          <div className="firstRunGuide">
            <h2 className="firstRunTitle">Your first governed run</h2>
            <p className="firstRunLede">
              An agent researches and drafts for you; you approve the exact action; it runs for real; every
              step is recorded. Three steps to see it end to end.
            </p>
            <ol className="firstRunSteps">
              <li>
                <strong>Set your model key.</strong> Open <em>Profile → Provider keys</em> and paste one API
                key. Planning uses AgentDock&rsquo;s model; <em>your runs</em> use this key of yours.
              </li>
              <li>
                <strong>Try a starter goal.</strong> We&rsquo;ll plan a research-and-draft flow for you — it
                drafts an email to you (nothing is sent).
                <div className="firstRunAction">
                  <Button variant="primary" size="sm" loading={planning} onClick={() => handleDescribe(STARTER_GOAL)}>
                    ▶ Plan my starter flow
                  </Button>
                </div>
              </li>
              <li>
                <strong>Approve the draft.</strong> When it&rsquo;s ready to create the email it pauses for your
                one-click approval — nothing leaves your account until you approve. Then you see the deliverable
                and the full audit trail.
              </li>
            </ol>
            <p className="firstRunNote">
              Prefer your own goal? Type it in the box on the left and press <em>Plan</em>.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={<span className="emptyGlyph">◎</span>}
            title="Select or describe a flow"
            body="Pick a saved flow from the dropdown, or describe one and let the orchestrator compose it."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => (document.querySelector(openDrawer === "build" ? ".commandInput" : ".describeInput") as HTMLInputElement | null)?.focus()}
              >
                Describe a flow
              </Button>
            }
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
              prompt={describeText}
              setPrompt={setDescribeText}
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
