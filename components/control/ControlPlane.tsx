"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "../layout/Toast";

import {
  getRealRun,
  killRealRun,
  listFlows,
  listRealRuns,
  listRuns,
  resolveApproval,
  simulateRun,
  startRealRun,
  type RealRun,
  type RealRunEvent,
  type RealRunSummary
} from "../../lib/api/client";
import type {
  AuditEvent,
  Decision,
  PersistedApprovalRequest,
  PersistedWorkflow,
  PersistedWorkflowRun,
  Section
} from "../../lib/types";
import { Button, Card, Data, EmptyState, PageHeader, Pill } from "../layout/primitives";
import { ApprovalCard, EventCard, auditEventToA2UI, runEventToA2UI, type A2UIEvent } from "../a2ui/EventCard";

const DECISION_FILTERS: { key: Decision | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "allowed", label: "Allowed" },
  { key: "approval_required", label: "Approval" },
  { key: "blocked", label: "Blocked" }
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function compactDate(iso?: string | null): string {
  if (!iso) return "not ended";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusTone(status: string): "ok" | "warn" | "danger" | "accent" | "neutral" {
  if (status === "completed") return "ok";
  if (status === "paused_for_approval") return "warn";
  if (status === "running" || status === "queued") return "accent";
  if (status.startsWith("halted_") || status === "killed" || status === "failed" || status === "blocked") return "danger";
  return "neutral";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

// The card's one-liner: the deliverable preview when there is one, otherwise a
// status-derived line. Never a model call — purely computed.
function boardLine(run: RealRunSummary): string {
  if (run.resultPreview) return run.resultPreview;
  switch (run.status) {
    case "running":
    case "queued":
      return "Running…";
    case "paused_for_approval":
      return "Awaiting your approval";
    case "halted_cost":
      return "Halted — budget cap reached";
    case "halted_error":
      return "Halted";
    case "killed":
      return "Killed by you";
    case "completed":
      return "Completed — no text deliverable";
    default:
      return statusLabel(run.status);
  }
}

function CapturedRunEvent({
  event
}: {
  event: RealRunEvent;
}) {
  const meta = event.metadata ?? {};
  const decision = (event.decision ?? "info") as Decision;
  return (
    <div className="capturedRunEvent">
      <EventCard
        event={{
          id: event.id,
          who: event.actorType === "agent" ? "Agent" : event.actorType === "human" ? "You" : "System",
          what: event.title,
          resource: event.resourceType ?? undefined,
          authority: event.authorityRef ?? undefined,
          decision,
          timestamp: event.createdAt,
          costCents: event.costCents,
          eventType: event.eventType
        }}
      />
      {(meta.modelOutput || meta.toolInput || meta.toolOutput || meta.handoffContent) && (
        <div className="capturedPayload">
          {meta.handoffFrom && meta.handoffTo && (
            <div className="payloadRow">
              <span>handoff</span>
              <code>{meta.handoffFrom} → {meta.handoffTo}</code>
            </div>
          )}
          {meta.toolInput && (
            <div className="payloadRow">
              <span>input</span>
              <pre>{meta.toolInput}</pre>
            </div>
          )}
          {meta.toolOutput && (
            <div className="payloadRow">
              <span>{event.untrusted ? "untrusted output" : "output"}</span>
              <pre>{meta.toolOutput}</pre>
            </div>
          )}
          {meta.handoffContent && (
            <div className="payloadRow">
              <span>untrusted handoff</span>
              <pre>{meta.handoffContent}</pre>
            </div>
          )}
          {meta.modelOutput && (
            <div className="payloadRow">
              <span>{meta.envelopeType === "final" ? "final" : "model envelope"}</span>
              <pre>{meta.modelOutput}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunDetail({
  run,
  decisionFilter,
  filters,
  onFilter,
  events,
  onBack
}: {
  run: RealRun;
  decisionFilter: Decision | "all";
  filters: { key: Decision | "all"; label: string }[];
  onFilter: (key: Decision | "all") => void;
  events: RealRunEvent[];
  onBack: () => void;
}) {
  const agentCount = new Set(run.events.map((e) => e.agentId ?? "system")).size;
  const toolCount = run.toolCallCount;
  const approvals = run.approvalRequests.length;
  const summaryLine = `${run.status.replaceAll("_", " ")} · ${agentCount} agent${agentCount === 1 ? "" : "s"} · ${toolCount} tool${toolCount === 1 ? "" : "s"} · ${(run.totalCostCents / 100).toFixed(2)} spent${approvals ? ` · ${approvals} pending approval${approvals === 1 ? "" : "s"}` : ""}`;
  return (
    <>
      <div className="opsFeedHead">
        <div>
          <button className="backLink" onClick={onBack}>← All runs</button>
          <h3>{run.workflowName ?? "Run"}</h3>
        </div>
      </div>

      <article className="finalDeliverable">
        <div>
          <span className="a2uiCaption">Output</span>
          <h3>What this run produced</h3>
        </div>
        {run.resultText ? <pre>{run.resultText}</pre> : <p className="inspectorNote">No text deliverable was produced (the run did not reach a final answer).</p>}
        <p className="runSummaryLine">{summaryLine}</p>
      </article>

      <div className="processHeader">
        <h4>Process</h4>
        <div className="opsFilters" role="group" aria-label="Filter process by decision">
          {filters.map((filter) => (
            <button
              key={filter.key}
              className={`filterChip${decisionFilter === filter.key ? " active" : ""}`}
              onClick={() => onFilter(filter.key)}
              aria-pressed={decisionFilter === filter.key}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <div className="opsFeedList">
        {events.length ? (
          events.map((event) => <CapturedRunEvent key={event.id} event={event} />)
        ) : (
          <EmptyState title="No matching steps" body="Adjust the filter to see the run process." />
        )}
      </div>
    </>
  );
}

export function ControlPlane({
  events,
  spend,
  pendingApprovals,
  defaultAgent,
  runHistory,
  onRun,
  onOpenSection
}: {
  events: AuditEvent[];
  spend: number;
  pendingApprovals: number;
  defaultAgent: string;
  runHistory: string[];
  onRun: () => void;
  onOpenSection: (section: Section) => void;
}) {
  const { data: session } = useSession();
  const toast = useToast();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<PersistedWorkflowRun[]>([]);
  const [realRunHistory, setRealRunHistory] = useState<RealRunSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [dbApprovals, setDbApprovals] = useState<PersistedApprovalRequest[]>([]);
  const [runningControlSimulation, setRunningControlSimulation] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<Decision | "all">("all");
  // Real governed run (Chunk 4).
  const [liveRun, setLiveRun] = useState<RealRun | null>(null);
  // Chunk 7: the board is the entry point; a run is only opened on click.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [startingReal, setStartingReal] = useState(false);
  const [killing, setKilling] = useState(false);
  const [openingRunId, setOpeningRunId] = useState("");

  const loadControlPlaneData = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      setWorkflowRuns([]);
      setRealRunHistory([]);
      setSelectedWorkflowId("");
      setDbApprovals([]);
      return;
    }

    try {
      const [workflowsData, runsData, realRunsData] = await Promise.all([
        listFlows("Unable to load saved Flows."),
        listRuns("Unable to load runs."),
        listRealRuns("Unable to load real runs.")
      ]);

      const runs: PersistedWorkflowRun[] = runsData.workflowRuns ?? [];
      const workflows = workflowsData.workflows ?? [];
      setSavedWorkflows(workflows);
      setWorkflowRuns(runs);
      setRealRunHistory(realRunsData.runs ?? []);
      setSelectedWorkflowId((current) => current || workflows[0]?.id || "");
      setDbApprovals(runs.flatMap((run) => run.approvalRequests).filter((approval) => approval.status === "pending"));
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to load Control data.", "danger");
    }
  };

  useEffect(() => {
    loadControlPlaneData();
  }, [session?.user?.email]);

  const runControlPlaneWorkflow = async () => {
    if (!session?.user) {
      onRun();
      return;
    }

    const workflow = savedWorkflows.find((item) => item.id === selectedWorkflowId) ?? savedWorkflows[0];
    if (!workflow?.id) {
toast("Save a Flow first to run a preview.", "warn");
      return;
    }

    setRunningControlSimulation(true);
    try {
      const data = await simulateRun(workflow.id, "Run preview failed.");
toast(`Run created: ${data.workflowRun.events.length} events, ${data.workflowRun.approvalRequests.length} approvals.`, "ok");
      await loadControlPlaneData();
    } catch (error) {
toast(error instanceof Error ? error.message : "Run preview failed.", "danger");
    } finally {
      setRunningControlSimulation(false);
    }
  };

  const resolveControlApproval = async (approvalId: string, status: "approved" | "denied" | "edited") => {
    setResolvingApprovalId(approvalId);
    try {
      await resolveApproval(approvalId, status, "Unable to resolve approval.");
toast(`Approval ${status} and written to timeline.`, "ok");
      await loadControlPlaneData();
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to resolve approval.", "danger");
    } finally {
      setResolvingApprovalId("");
    }
  };

  // --- Real governed run ---
  const realEventToA2UI = (e: RealRun["events"][number]): A2UIEvent => ({
    id: e.id,
    who: e.actorType === "agent" ? "Agent" : e.actorType === "human" ? "You" : "System",
    what: e.title,
    resource: e.resourceType ?? undefined,
    authority: e.authorityRef ?? undefined,
    decision: (e.decision ?? "info") as Decision,
    timestamp: e.createdAt,
    costCents: e.costCents,
    eventType: e.eventType
  });

  const refreshLiveRun = async (id: string) => {
    try {
      const data = await getRealRun(id);
      setLiveRun(data.run);
      if (["paused_for_approval"].includes(data.run.status)) await loadControlPlaneData();
    } catch {
      /* keep last state */
    }
  };

  const startReal = async () => {
    if (!session?.user) return toast("Sign in and add a provider key in Profile to run for real.", "warn");
    const workflow = savedWorkflows.find((w) => w.id === selectedWorkflowId) ?? savedWorkflows[0];
    if (!workflow?.id) return toast("Save a flow first to run it.", "warn");
    setStartingReal(true);
    try {
      const data = await startRealRun(workflow.id);
      toast(`Run ${data.run.status.replaceAll("_", " ")}.`, data.run.status === "completed" ? "ok" : "info");
      setSelectedRunId(data.run.runId);
      await refreshLiveRun(data.run.runId);
      await loadControlPlaneData();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to start run.", "danger");
    } finally {
      setStartingReal(false);
    }
  };

  const openRun = async (runId: string) => {
    setOpeningRunId(runId);
    try {
      const data = await getRealRun(runId);
      setLiveRun(data.run);
      setSelectedRunId(runId);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to open run.", "danger");
    } finally {
      setOpeningRunId("");
    }
  };

  const backToBoard = () => {
    setSelectedRunId(null);
    setLiveRun(null);
    setDecisionFilter("all");
    loadControlPlaneData();
  };

  const killLive = async () => {
    if (!liveRun) return;
    setKilling(true);
    try {
      await killRealRun(liveRun.id);
      toast("Run killed.", "warn");
      await refreshLiveRun(liveRun.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to kill run.", "danger");
    } finally {
      setKilling(false);
    }
  };

  // TODO(stream): poll while a run is in flight. SSE event-streaming replaces this later.
  useEffect(() => {
    if (!selectedRunId || !liveRun || !["running", "queued", "paused_for_approval"].includes(liveRun.status)) return;
    const id = window.setInterval(() => refreshLiveRun(liveRun.id), 1500);
    return () => window.clearInterval(id);
  }, [selectedRunId, liveRun?.id, liveRun?.status]);

  // Chunk 7: keep the board live while any run is active — poll the lightweight
  // list endpoint (never each run's full detail), and stop when nothing runs.
  const ACTIVE_STATUSES = ["running", "queued", "paused_for_approval"];
  const boardHasActiveRun = realRunHistory.some((run) => ACTIVE_STATUSES.includes(run.status));
  useEffect(() => {
    if (selectedRunId || !session?.user || !boardHasActiveRun) return;
    const id = window.setInterval(() => {
      listRealRuns("Unable to load real runs.")
        .then((data) => setRealRunHistory(data.runs ?? []))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, [selectedRunId, session?.user?.email, boardHasActiveRun]);

  const resolveLiveApproval = async (approvalId: string, status: "approved" | "denied" | "edited") => {
    setResolvingApprovalId(approvalId);
    try {
      await resolveApproval(approvalId, status, "Unable to resolve approval.");
      toast(status === "denied" ? "Denied — run halted." : "Approved — run resumed.", status === "denied" ? "warn" : "ok");
      if (liveRun) await refreshLiveRun(liveRun.id);
      await loadControlPlaneData();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to resolve approval.", "danger");
    } finally {
      setResolvingApprovalId("");
    }
  };

  const RUN_CAP_CENTS = 50;
  const liveRunning = liveRun ? ["running", "queued", "paused_for_approval"].includes(liveRun.status) : false;
  const detailMode = Boolean(selectedRunId && liveRun);

  const filteredLiveEvents = liveRun
    ? (decisionFilter === "all"
      ? liveRun.events
      : liveRun.events.filter((e) => (e.decision ?? "info") === decisionFilter))
    : [];
  const selectedWorkflow = savedWorkflows.find((workflow) => workflow.id === selectedWorkflowId);

  // Spend panel computed from already-fetched data — no new endpoint.
  const dbSpendCents = workflowRuns.reduce((sum, run) => sum + run.totalCostCents, 0);
  const todaySpendCents = session?.user ? dbSpendCents : Math.round(spend * 100);
  // Recent costs come straight from the run list — no per-run detail fetch.
  const recentCosts = realRunHistory.filter((run) => run.totalCostCents > 0).slice(0, 5);
  const capCents = 500;
  const pendingCount = dbApprovals.length || pendingApprovals;
  const activeRunCount = realRunHistory.filter((run) => ACTIVE_STATUSES.includes(run.status)).length;

  return (
    <section className="platformPage controlPlanePage">
      <PageHeader eyebrow="Control" title="Control" copy="A calm board of your real governed runs. Open one to see its output and process." />

      <div className="opsRoom">
        <div className="opsFeed">
          {detailMode ? (
            <RunDetail
              run={liveRun!}
              decisionFilter={decisionFilter}
              filters={DECISION_FILTERS}
              onFilter={setDecisionFilter}
              events={filteredLiveEvents}
              onBack={backToBoard}
            />
          ) : (
            <>
              <div className="opsFeedHead">
                <div>
                  <h3>Runs</h3>
                  <span className="a2uiCaption">Real governed runs · newest first</span>
                </div>
                <div className="buttonPair">
                  {activeRunCount > 0 && <Pill tone="accent">{activeRunCount} active</Pill>}
                  <Pill tone="neutral">{realRunHistory.length} runs</Pill>
                </div>
              </div>
              {session?.user ? (
                realRunHistory.length ? (
                  <div className="runBoard">
                    {realRunHistory.map((run) => (
                      <button
                        key={run.id}
                        className="runCard"
                        onClick={() => openRun(run.id)}
                        disabled={openingRunId === run.id}
                        aria-busy={openingRunId === run.id}
                      >
                        <div className="runCardTop">
                          <strong className="runCardName">{run.workflowName ?? "Untitled flow"}</strong>
                          <Pill tone={statusTone(run.status)}>{statusLabel(run.status)}</Pill>
                        </div>
                        <p className="runCardLine">{boardLine(run)}</p>
                        <div className="runCardMeta">
                          <Data>{formatCents(run.totalCostCents)}</Data>
                          <span>{run.stepCount} steps · {run.toolCallCount} tools</span>
                          {run.status === "paused_for_approval" && <span className="runCardBadge">needs approval</span>}
                          <small>{compactDate(run.endedAt ?? run.createdAt)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No real runs yet"
                    body="Select a saved Flow in the panel and run it for real. Each run appears here as a card."
                  />
                )
              ) : (
                <EmptyState
                  title="Sign in to run real flows"
                  body="Control shows your real governed runs. Sign in with Google and add a provider key in Profile to start one."
                />
              )}
              <p className="opsFooterNote">
                Real runs only: model calls and web search execute for real and are metered. Unimplemented tools are shown as unavailable, never fake success. Open a card to see its output and full process.
              </p>
            </>
          )}
        </div>

        <div className="opsAside">
          <Card title="Start a run" meta={session?.user ? `${activeRunCount} active` : "Sign in to run"}>
            {session?.user && (
              <label className="flowSelector">
                <span>Flow to run</span>
                <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
                  {savedWorkflows.length ? (
                    savedWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)
                  ) : (
                    <option value="">No saved flows</option>
                  )}
                </select>
              </label>
            )}
            {detailMode ? (
              <div className="runMetricGrid">
                <div className="metric"><span>Real spend</span><strong className="data">${(liveRun!.totalCostCents / 100).toFixed(2)} / ${(RUN_CAP_CENTS / 100).toFixed(2)}</strong></div>
                <div className="metric"><span>Steps</span><strong className="data">{liveRun!.stepCount}</strong></div>
                <div className="metric"><span>Tools executed</span><strong className="data">{liveRun!.toolCallCount}</strong></div>
                <div className="metric"><span>Status</span><strong className="data">{statusLabel(liveRun!.status)}</strong></div>
              </div>
            ) : (
              <p className="inspectorNote">
                {selectedWorkflow
                  ? `${selectedWorkflow.name} is selected. Runs use the saved agents, tools, memory, and grants for that Flow.`
                  : "Save a flow first, then select it here to run for real on your BYO key."}
              </p>
            )}
            <div className="heroActions compactActions">
              <Button variant="primary" onClick={startReal} loading={startingReal} disabled={liveRunning}>Run for real</Button>
              {detailMode && liveRunning && <Button variant="danger" onClick={killLive} loading={killing}>Kill run</Button>}
              {detailMode && <Button variant="secondary" onClick={backToBoard}>Back to board</Button>}
            </div>
          </Card>

          <Card title="Approval inbox" meta={`${(liveRun?.approvalRequests.length ?? 0) || pendingCount} pending`}>
            {detailMode && (liveRun?.approvalRequests.length ?? 0) > 0 ? (
              <div className="opsFeedList">
                {liveRun!.approvalRequests.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onResolve={resolveLiveApproval} resolving={resolvingApprovalId === approval.id} />
                ))}
              </div>
            ) : dbApprovals.length ? (
              <div className="opsFeedList">
                {dbApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onResolve={resolveControlApproval}
                    resolving={resolvingApprovalId === approval.id}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="Inbox clear" body="No approvals waiting. New ones appear here the moment an agent needs you." />
            )}
          </Card>

          <Card title="Spend" meta="$5.00 weekly cap">
            <div className="spendTotal">${(todaySpendCents / 100).toFixed(2)}</div>
            <div className="spendCap">of $5.00 weekly cap</div>
            <div className="meter"><span style={{ width: `${Math.min(100, (todaySpendCents / capCents) * 100)}%` }} /></div>
            {recentCosts.length > 0 && (
              <div className="spendRows">
                {recentCosts.map((run) => (
                  <div className="spendRow" key={run.id}>
                    <span>{run.workflowName ?? "Untitled flow"}</span>
                    <Data>{formatCents(run.totalCostCents)}</Data>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
