"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "../layout/Toast";

import { getRealRun, killRealRun, listFlows, listRuns, resolveApproval, simulateRun, startRealRun, type RealRun } from "../../lib/api/client";
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
  const [dbApprovals, setDbApprovals] = useState<PersistedApprovalRequest[]>([]);
  const [runningControlSimulation, setRunningControlSimulation] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<Decision | "all">("all");
  // Real governed run (Chunk 4).
  const [liveRun, setLiveRun] = useState<RealRun | null>(null);
  const [startingReal, setStartingReal] = useState(false);
  const [killing, setKilling] = useState(false);

  const loadControlPlaneData = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      setWorkflowRuns([]);
      setDbApprovals([]);
      return;
    }

    try {
      const [workflowsData, runsData] = await Promise.all([
        listFlows("Unable to load saved Flows."),
        listRuns("Unable to load runs.")
      ]);

      const runs: PersistedWorkflowRun[] = runsData.workflowRuns ?? [];
      setSavedWorkflows(workflowsData.workflows ?? []);
      setWorkflowRuns(runs);
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

    const workflow = savedWorkflows.find((item) => item.name === "Job Search Automation") ?? savedWorkflows[0];
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
    const workflow = savedWorkflows.find((w) => w.name === "Job Search Automation") ?? savedWorkflows[0];
    if (!workflow?.id) return toast("Save a flow first to run it.", "warn");
    setStartingReal(true);
    try {
      const data = await startRealRun(workflow.id);
      toast(`Run ${data.run.status.replaceAll("_", " ")}.`, data.run.status === "completed" ? "ok" : "info");
      await refreshLiveRun(data.run.runId);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to start run.", "danger");
    } finally {
      setStartingReal(false);
    }
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
    if (!liveRun || !["running", "queued", "paused_for_approval"].includes(liveRun.status)) return;
    const id = window.setInterval(() => refreshLiveRun(liveRun.id), 1500);
    return () => window.clearInterval(id);
  }, [liveRun?.id, liveRun?.status]);

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

  // Unify the feed: DB run events when signed in, mock audit events otherwise.
  const feed: A2UIEvent[] = useMemo(() => {
    // A live real run takes the timeline; its events show newest-last like the demo feed.
    if (liveRun) return liveRun.events.map(realEventToA2UI);
    if (session?.user) {
      return workflowRuns.flatMap((run) => run.events.map(runEventToA2UI));
    }
    return events.map(auditEventToA2UI);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user, workflowRuns, events, liveRun]);

  const filteredFeed = decisionFilter === "all" ? feed : feed.filter((e) => e.decision === decisionFilter);

  // Spend panel computed from already-fetched data — no new endpoint.
  const dbSpendCents = workflowRuns.reduce((sum, run) => sum + run.totalCostCents, 0);
  const todaySpendCents = session?.user ? dbSpendCents : Math.round(spend * 100);
  const recentCosts = feed.filter((e) => typeof e.costCents === "number" && (e.costCents ?? 0) > 0).slice(0, 5);
  const capCents = 500;
  const pendingCount = dbApprovals.length || pendingApprovals;

  return (
    <section className="platformPage controlPlanePage">
      <PageHeader eyebrow="Control" title="Control" copy="Approvals, blocks, spend, and timeline." />

      <div className="opsRoom">
        <div className="opsFeed">
          <div className="opsFeedHead">
            <div>
              <h3>Timeline</h3>
              <span className="a2uiCaption">A2UI · agent-to-user interface</span>
            </div>
            <Pill tone="neutral">{filteredFeed.length} events</Pill>
          </div>
          <div className="opsFilters" role="group" aria-label="Filter timeline by decision">
            {DECISION_FILTERS.map((filter) => (
              <button
                key={filter.key}
                className={`filterChip${decisionFilter === filter.key ? " active" : ""}`}
                onClick={() => setDecisionFilter(filter.key)}
                aria-pressed={decisionFilter === filter.key}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="opsFeedList">
            {filteredFeed.length ? (
              filteredFeed.map((event) => <EventCard key={event.id} event={event} />)
            ) : (
              <EmptyState
                title="No events yet"
                body="Run a flow preview to see agent activity stream in here."
                action={<Button variant="primary" onClick={runControlPlaneWorkflow} loading={runningControlSimulation}>Run preview</Button>}
              />
            )}
          </div>
          <p className="opsFooterNote">
            {liveRun
              ? "Real run: model calls and web search execute for real and are metered. Other tools are gated and shown as simulated."
              : "“Run for real” executes a real, governed run (real model calls, real cost, one real read-only tool). “Run preview” is simulated."}
          </p>
        </div>

        <div className="opsAside">
          <Card title="Active run" meta={liveRun ? liveRun.status.replaceAll("_", " ") : (session?.user ? "None yet" : "Demo ready")}>
            {liveRun ? (
              <div className="runMetricGrid">
                <div className="metric"><span>Real spend</span><strong className="data">${(liveRun.totalCostCents / 100).toFixed(2)} / ${(RUN_CAP_CENTS / 100).toFixed(2)}</strong></div>
                <div className="metric"><span>Steps</span><strong className="data">{liveRun.stepCount}</strong></div>
                <div className="metric"><span>Tool calls</span><strong className="data">{liveRun.toolCallCount}</strong></div>
                <div className="metric"><span>Status</span><strong className="data">{liveRun.status}</strong></div>
              </div>
            ) : (
              <p className="inspectorNote">Run a saved flow for real on your BYO key. Real model calls, real cost, governed by the policy gate.</p>
            )}
            <div className="heroActions compactActions">
              <Button variant="primary" onClick={startReal} loading={startingReal} disabled={liveRunning}>Run for real</Button>
              {liveRunning && <Button variant="danger" onClick={killLive} loading={killing}>Kill run</Button>}
              <Button variant="secondary" onClick={runControlPlaneWorkflow} loading={runningControlSimulation}>Run preview (simulated)</Button>
            </div>
          </Card>

          <Card title="Approval inbox" meta={`${(liveRun?.approvalRequests.length ?? 0) || pendingCount} pending`}>
            {(liveRun?.approvalRequests.length ?? 0) > 0 ? (
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
                {recentCosts.map((event) => (
                  <div className="spendRow" key={event.id}>
                    <span>{event.what}</span>
                    <Data>${((event.costCents ?? 0) / 100).toFixed(2)}</Data>
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
