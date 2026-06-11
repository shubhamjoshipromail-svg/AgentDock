"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { listActivity } from "../../lib/api/client";
import { activityLogToAuditEvent } from "../mock-data";
import type { AuditEvent, PersistedActivityLog } from "../../lib/types";
import { Metric, PageHeader } from "../layout/primitives";

export function Activity({ events }: { events: AuditEvent[] }) {
  const { data: session } = useSession();
  const [activityLogs, setActivityLogs] = useState<PersistedActivityLog[]>([]);
  const [activityMessage, setActivityMessage] = useState("");
  const [loadingActivity, setLoadingActivity] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setActivityLogs([]);
      return;
    }

    const loadActivity = async () => {
      setLoadingActivity(true);
      setActivityMessage("");

      try {
        const data = await listActivity("Unable to load Timeline.");
        setActivityLogs(data.activityLogs ?? []);
      } catch (error) {
        setActivityMessage(error instanceof Error ? error.message : "Unable to load Timeline. Showing mock fallback.");
      } finally {
        setLoadingActivity(false);
      }
    };

    loadActivity();
  }, [session?.user?.email]);

  const visibleEvents = session?.user && activityLogs.length
    ? activityLogs.map(activityLogToAuditEvent)
    : events;

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Timeline" title="Timeline" copy="Runs, approvals, memory, tools, spend, and blocks." />
      {session?.user ? (
        <div className="profileAuthNotice">
          {activityLogs.length ? `Showing ${activityLogs.length} DB-backed Timeline rows from Postgres.` : "No DB-backed Timeline yet. Run a preview to persist events."}
        </div>
      ) : (
        <div className="profileAuthNotice">Signed-out demo mode: showing mock Timeline. Sign in to persist runs.</div>
      )}
      {loadingActivity && <div className="profileAuthNotice">Loading DB-backed Timeline...</div>}
      {activityMessage && <div className="profileAuthNotice">{activityMessage}</div>}
      <div className="filterBar">
        {["type", "agent", "Flow", "tool", "access", "memory", "cost", "decision"].map((filter) => <span key={filter}>{filter}</span>)}
      </div>
      <div className="activityTimeline fullTimeline">
        {visibleEvents.map((event, index) => (
          <div className="auditRow" key={`${event.event}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{event.event}</strong>
              <p>{event.agent} - {event.workflow} - {event.tool}</p>
            </div>
            <Metric label="Permission" value={event.permission} />
            <Metric label="Type" value={event.type} />
            <Metric label="Memory" value={event.memory} />
            <Metric label="Cost" value={event.cost} />
            <b className={`decisionBadge ${event.decision}`}>{event.decision.replace("_", " ")}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
