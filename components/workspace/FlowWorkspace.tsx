"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import {
  attachToolToFlow,
  getRealRun,
  killRealRun,
  listConnections,
  listDiscoveredTools,
  listFlows,
  removeToolGrant,
  resolveApproval,
  startRealRun,
  type DiscoveredTool,
  type PersistedConnection,
  type RealRun
} from "../../lib/api/client";
import type { PersistedWorkflow } from "../../lib/types";
import { Badge, Button, EmptyState } from "../layout/primitives";
import { useToast } from "../layout/Toast";
import "./workspace.css";

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

type RunState = {
  runId: string | null;
  status: string;
  output: string | null;
  steps: { title: string; description: string; decision: string | null; costCents: number }[];
  approvals: { id: string; title: string; description: string; status: string }[];
  toolCallCount: number;
  stepCount: number;
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

  const [flows, setFlows] = useState<PersistedWorkflow[]>([]);
  const [flow, setFlow] = useState<PersistedWorkflow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedP, setSelectedP] = useState<string | null>(null);
  const [connections, setConnections] = useState<PersistedConnection[]>([]);
  const [availableTools, setAvailableTools] = useState<DiscoveredTool[]>([]);

  const [run, setRun] = useState<RunState>({ runId: null, status: "", output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0 });
  const [running, setRunning] = useState(false);
  const [pollId, setPollId] = useState<ReturnType<typeof setInterval> | null>(null);

  // Describe-to-build
  const [describeText, setDescribeText] = useState("");
  const [planning, setPlanning] = useState(false);

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

  // --- Run ---
  const handleRun = async () => {
    if (!flowId) return toast("Select a flow first.", "warn");
    setRunning(true);
    try {
      const result = await startRealRun(flowId);
      setRun({ runId: result.run.runId, status: result.run.status, output: null, steps: [], approvals: [], toolCallCount: 0, stepCount: 0 });
      toast("Run queued. The worker will pick it up.", "ok");

      // Poll for updates.
      const id = setInterval(async () => {
        try {
          const data = await getRealRun(result.run.runId);
          const r: RealRun = data.run;
          setRun({
            runId: r.id,
            status: r.status,
            output: r.resultText ?? null,
            steps: r.events?.map((e) => ({ title: e.title, description: e.description, decision: e.decision, costCents: e.costCents })) ?? [],
            approvals: r.approvalRequests?.filter((a) => a.status === "pending") ?? [],
            toolCallCount: r.toolCallCount,
            stepCount: r.stepCount
          });
          if (["completed", "halted_error", "halted_cost", "killed"].includes(r.status)) {
            clearInterval(id);
            setRunning(false);
            setPollId(null);
            toast(r.status === "completed" ? "Run complete." : `Run ended: ${r.status}`, r.status === "completed" ? "ok" : "warn");
          }
        } catch { /* poll error, skip */ }
      }, 2000);
      setPollId(id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Run failed.", "danger");
      setRunning(false);
    }
  };

  const handleKill = async () => {
    if (!run.runId) return;
    try {
      await killRealRun(run.runId);
      toast("Run killed.", "warn");
      if (pollId) clearInterval(pollId);
      setRunning(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Kill failed.", "danger");
    }
  };

  const handleApprove = async (approvalId: string, approved: boolean) => {
    try {
      await resolveApproval(approvalId, approved ? "approved" : "denied");
      toast(approved ? "Approved. Worker will resume." : "Denied.", approved ? "ok" : "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Approval failed.", "danger");
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
  const selected = participants.find((p) => p.agentId === selectedP);
  const grantedToolIds = new Set(participants.flatMap((p) => p.tools.map((t) => t.serverId)));

  if (!session?.user) {
    return <EmptyState icon={<span style={{ fontSize: 28 }}>🔐</span>} title="Sign in to use the workspace" body="Sign in with Google to build, grant, run, and watch your flows." />;
  }

  return (
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

        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <select
            style={{ width: "100%", background: "var(--surface)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
            value={flowId ?? ""}
            onChange={(e) => { if (onFlowChange) onFlowChange(e.target.value || null); if (e.target.value) loadFlow(e.target.value); }}
          >
            <option value="">Select a flow…</option>
            {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        <div className="participantsHead">
          <h2>Participants</h2>
          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{participants.length} agent{participants.length !== 1 ? "s" : ""}</span>
        </div>

        {participants.map((p) => (
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
            <div className="participantToolChips">
              {p.tools.length === 0 && <span className="toolChip" data-granted={false}>no tools granted</span>}
              {p.tools.filter((t) => !t.revoked).map((t) => (
                <span className="toolChip" key={t.serverId} data-granted={true} data-risk={t.isExternalSend ? "high" : undefined}>
                  {t.toolName}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* CENTER: Run + Output */}
      <div className="workspaceCenter">
        {flow ? (
          <>
            <div className="runBar">
              <h2>{flow.name}</h2>
              <Button variant="primary" size="sm" loading={running} onClick={handleRun} disabled={running}>
                {running ? "Running…" : "▶ Run"}
              </Button>
              {running && (
                <Button variant="danger" size="sm" onClick={handleKill}>
                  Kill
                </Button>
              )}
              {run.status && (
                <span style={{ fontSize: "0.75rem", color: run.status === "completed" ? "var(--ok)" : run.status.includes("halted") ? "var(--danger)" : "var(--muted)" }}>
                  {run.status} · {run.toolCallCount} tools · {run.stepCount} model steps
                </span>
              )}
            </div>

            {run.output ? (
              <div className="runOutput">{run.output}</div>
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

            {run.approvals.map((a) => (
              <div className="approvalInline" key={a.id}>
                <div className="approvalInlineHead">
                  <strong>⚠ {a.title}</strong>
                  <Badge risk="high" />
                </div>
                <div className="approvalInlineDetail">{a.description}</div>
                <div className="approvalInlineActions">
                  <Button variant="primary" size="sm" onClick={() => handleApprove(a.id, true)}>Approve</Button>
                  <Button variant="danger" size="sm" onClick={() => handleApprove(a.id, false)}>Deny</Button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>◎</span>}
            title="Select or describe a flow"
            body="Pick a saved flow from the dropdown, or describe one above and press Plan."
          />
        )}
      </div>

      {/* RIGHT: Inspector — grants + blast radius */}
      <div className="workspaceRight">
        {selected ? (
          <>
            <div className="inspectorSection">
              <h3>{selected.agentName}</h3>
              <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{selected.role}</p>
            </div>

            <div className="inspectorSection">
              <h3>Granted tools</h3>
              {selected.tools.filter((t) => !t.revoked).map((t) => (
                <div className="inspectorGrantRow" key={t.serverId}>
                  <div>
                    <strong>{t.toolName}</strong>
                    <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>{t.permission.replaceAll("_", " ")}</div>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleRevoke(selected, t.serverId)}>
                    Revoke
                  </Button>
                </div>
              ))}
              {selected.tools.every((t) => t.revoked) && (
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", padding: "0.5rem 0" }}>
                  No active grants. Grant tools below.
                </div>
              )}
            </div>

            <div className="inspectorSection">
              <h3>Discover & grant</h3>
              {availableTools.filter((t) => !grantedToolIds.has(t.serverRowId)).slice(0, 8).map((t) => (
                <div className="inspectorGrantRow" key={t.serverRowId}>
                  <div>
                    <strong>{t.toolName}</strong>
                    <Badge risk={t.isExternalSend ? "high" : "low"} />
                    <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>{t.description?.slice(0, 80)}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleGrant(selected, t)}>
                    Grant
                  </Button>
                </div>
              ))}
              {availableTools.length === 0 && (
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  No discovered tools. Connect a server and discover its tools first.
                </div>
              )}
            </div>

            {/* Blast-radius mini: permission depth per capability */}
            <div className="inspectorSection">
              <h3>Blast radius (permission depth)</h3>
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
              <p style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                Drag to adjust. External-write always requires approval at run time.
              </p>
            </div>
          </>
        ) : (
          <EmptyState title="Select a participant" body="Click an agent on the left to see its tools and grants." />
        )}
      </div>
    </div>
  );
}
