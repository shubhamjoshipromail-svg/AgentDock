"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { listFlows, listRuns, resolveApproval, simulateRun } from "../../lib/api/client";
import { formatCents } from "../../lib/mock-data";
import type {
  AuditEvent,
  PersistedApprovalRequest,
  PersistedWorkflow,
  PersistedWorkflowRun,
  Section
} from "../../lib/types";
import { AuditList, Card, CapabilityBadge, DetailBlock, Metric, PageHeader } from "../layout/primitives";
import { ApprovalInbox } from "../shared/ApprovalInbox";

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
      setControlMessage("Save this Flow first to run a DB-backed preview.");
      return;
    }

    setRunningControlSimulation(true);
    setControlMessage("");

    try {
      const data = await simulateRun(workflow.id, "Run preview failed.");
      setControlMessage(`DB-backed run created: ${data.workflowRun.events.length} events and ${data.workflowRun.approvalRequests.length} approvals.`);
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
      setControlMessage(`Approval ${status} and written to Timeline.`);
      await loadControlPlaneData();
    } catch (error) {
      setControlMessage(error instanceof Error ? error.message : "Unable to resolve approval.");
    } finally {
      setResolvingApprovalId("");
    }
  };

  const latestRun = workflowRuns[0];
  const hasActiveRun = Boolean(latestRun) || !session?.user;
  const timelineItems = latestRun?.events?.length
    ? latestRun.events.slice(0, 6).map((event) => event.title)
    : session?.user ? [] : [
      "Job Discovery searched 12 roles",
      "Company Research summarized 3 companies",
      "Resume draft created",
      "Outreach drafts require approval",
      "Direct email send blocked by Policy Engine"
    ];

  return (
    <section className="platformPage controlPlanePage">
      <PageHeader
        eyebrow="Control"
        title="Control"
        copy="Approvals, blocks, spend, and timeline."
      />
      <div className="truthNotice">
        <CapabilityBadge kind={session?.user ? "db" : "mock"} />
        <strong>{session?.user ? "DB-backed mode active." : "You are in demo mode."}</strong>
        <span>Runs, approvals, and Timeline save when signed in. Real execution stays off.</span>
      </div>
      {controlMessage && <div className="profileAuthNotice compactNotice">{controlMessage}</div>}

      <div className="controlGrid">
        <Card title="Active run" meta={latestRun?.status?.replaceAll("_", " ") ?? (session?.user ? "None yet" : "Demo ready")}>
          {hasActiveRun ? (
            <div className="activeRunCard">
              <strong>{latestRun?.workflow.name ?? "Job Search Automation"}</strong>
              <div className="runMetricGrid">
                <Metric label="Spend" value={latestRun ? formatCents(latestRun.totalCostCents) : `$${spend.toFixed(2)} / $5.00`} />
                <Metric label="Pending approvals" value={`${dbApprovals.length || pendingApprovals}`} />
                <Metric label="Last run" value={latestRun ? new Date(latestRun.startedAt).toLocaleString() : runHistory[0] ?? "Not run yet"} />
              </div>
              <div className="heroActions compactActions">
                <button className="primaryButton" onClick={runControlPlaneWorkflow} disabled={runningControlSimulation}>
                  {runningControlSimulation ? "Running..." : "Run Preview"}
                </button>
                <button className="secondaryButton" onClick={() => onOpenSection("Build")}>Open Build</button>
              </div>
            </div>
          ) : (
            <div className="emptyWorkflowState">
              <strong>No run yet.</strong>
              <p>Save a Flow in Build, then run a preview.</p>
              <button className="primaryButton" onClick={() => onOpenSection("Build")}>Open Build</button>
            </div>
          )}
        </Card>
        <Card title="Timeline" meta={latestRun ? `${latestRun.events.length} events` : session?.user ? "No run yet" : "Mock preview"}>
          {timelineItems.length ? (
            <div className="runTimeline">
              {timelineItems.map((item, index) => (
              <div className="runTimelineItem" key={`${item}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{item}</p>
              </div>
              ))}
            </div>
          ) : (
            <div className="emptyWorkflowState">
              <strong>No timeline yet.</strong>
              <p>Run a preview to see events here.</p>
            </div>
          )}
        </Card>
        <ApprovalInbox
          items={["Review resume draft", "Approve 3 Gmail drafts", "Company Preferences access request", "Direct application submission blocked"]}
          approvals={dbApprovals}
          onResolve={resolveControlApproval}
          resolvingApprovalId={resolvingApprovalId}
          dbBacked={Boolean(session?.user && dbApprovals.length)}
        />
        <Card title="Recent Timeline" meta="Latest 5">
          <AuditList events={events.slice(0, 5)} compact />
          <div className="heroActions compactActions">
            <button className="secondaryButton" onClick={() => onOpenSection("Flows")}>View Flows</button>
          </div>
        </Card>
        <Card title="Spend" meta="$5 weekly cap">
          <div className="costWidget inlineCost">
            <span>Job Search Automation</span>
            <strong>${spend.toFixed(2)} / $5.00</strong>
            <div className="meter"><span style={{ width: `${Math.min(100, (spend / 5) * 100)}%` }} /></div>
          </div>
          <div className="softNote">Runs pause before the cap.</div>
        </Card>
        <Card title="Revoke" meta="Scoped">
          <DetailBlock label="Memory" value="Profile controls Memory Zones" />
          <DetailBlock label="Tools" value="Flow tool access lives in Flows" />
          <DetailBlock label="Access" value="Scoped Access lives in Flows" />
        </Card>
      </div>
    </section>
  );
}
