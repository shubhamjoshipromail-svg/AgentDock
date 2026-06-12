"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { listFlows, listRuns, resolveApproval, simulateRun } from "../../lib/api/client";
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
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<PersistedWorkflowRun[]>([]);
  const [dbApprovals, setDbApprovals] = useState<PersistedApprovalRequest[]>([]);
  const [controlMessage, setControlMessage] = useState("");
  const [runningControlSimulation, setRunningControlSimulation] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<Decision | "all">("all");

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
      setControlMessage(error instanceof Error ? error.message : "Unable to load Control data.");
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
      setControlMessage("Save a Flow first to run a preview.");
      return;
    }

    setRunningControlSimulation(true);
    setControlMessage("");
    try {
      const data = await simulateRun(workflow.id, "Run preview failed.");
      setControlMessage(`Run created: ${data.workflowRun.events.length} events, ${data.workflowRun.approvalRequests.length} approvals.`);
      await loadControlPlaneData();
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Run preview failed.");
    } finally {
      setRunningControlSimulation(false);
    }
  };

  const resolveControlApproval = async (approvalId: string, status: "approved" | "denied" | "edited") => {
    setResolvingApprovalId(approvalId);
    setControlMessage("");
    try {
      await resolveApproval(approvalId, status, "Unable to resolve approval.");
      setControlMessage(`Approval ${status} and written to timeline.`);
      await loadControlPlaneData();
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Unable to resolve approval.");
    } finally {
      setResolvingApprovalId("");
    }
  };

  // Unify the feed: DB run events when signed in, mock audit events otherwise.
  const feed: A2UIEvent[] = useMemo(() => {
    if (session?.user) {
      return workflowRuns.flatMap((run) => run.events.map(runEventToA2UI));
    }
    return events.map(auditEventToA2UI);
  }, [session?.user, workflowRuns, events]);

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
      {controlMessage && <div className="profileAuthNotice compactNotice">{controlMessage}</div>}

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
          <p className="opsFooterNote">Execution is off in this build. Events come from flow-plan calls and simulated runs.</p>
        </div>

        <div className="opsAside">
          <Card title="Active run" meta={workflowRuns[0]?.status?.replaceAll("_", " ") ?? (session?.user ? "None yet" : "Demo ready")}>
            <div className="runMetricGrid">
              <div className="metric"><span>Spend</span><strong className="data">${(todaySpendCents / 100).toFixed(2)} / $5.00</strong></div>
              <div className="metric"><span>Pending</span><strong className="data">{pendingCount}</strong></div>
            </div>
            <div className="heroActions compactActions">
              <Button variant="primary" onClick={runControlPlaneWorkflow} loading={runningControlSimulation}>Run preview</Button>
              <Button variant="secondary" onClick={() => onOpenSection("Build")}>Open Build</Button>
            </div>
          </Card>

          <Card title="Approval inbox" meta={`${pendingCount} pending`}>
            {dbApprovals.length ? (
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
