"use client";

import { ComingSoonButton } from "../layout/primitives";
import type { PersistedApprovalRequest } from "../../lib/types";

export function ApprovalInbox({
  items,
  approvals = [],
  onResolve,
  resolvingApprovalId = "",
  dbBacked = false
}: {
  items: string[];
  approvals?: PersistedApprovalRequest[];
  onResolve?: (approvalId: string, status: "approved" | "denied" | "edited") => void;
  resolvingApprovalId?: string;
  dbBacked?: boolean;
}) {
  const visibleApprovals = dbBacked ? approvals : [];

  return (
    <section className="plannerCard approvalInbox">
      <div className="panelHeader">
        <span>Approval Inbox</span>
        <strong>{dbBacked ? `${visibleApprovals.length} DB-backed pending` : `${items.length} pending`}</strong>
      </div>
      <div className="approvalInboxList">
        {visibleApprovals.map((approval) => (
          <article className="approvalInboxCard dbApproval" key={approval.id}>
            <strong>{approval.title}</strong>
            <span>{approval.agent?.name ?? "AgentDock"} - {approval.riskLevel} risk - persisted in Postgres</span>
            <p>{approval.description}</p>
            <div className="approvalActions">
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "approved")}>Approve</button>
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "denied")}>Deny</button>
              <button className="secondaryButton smallButton" disabled={resolvingApprovalId === approval.id} onClick={() => onResolve?.(approval.id, "edited")}>Edit policy</button>
            </div>
          </article>
        ))}
        {!dbBacked && items.map((item) => (
          <article className="approvalInboxCard" key={item}>
            <strong>{item}</strong>
            <span>{item.includes("blocked") ? "Blocked action" : "A2UI approval required"}</span>
            <div className="approvalActions">
              <ComingSoonButton>Approve</ComingSoonButton>
              <ComingSoonButton>Deny</ComingSoonButton>
              <ComingSoonButton>Edit policy</ComingSoonButton>
            </div>
          </article>
        ))}
        {dbBacked && visibleApprovals.length === 0 && (
          <article className="approvalInboxCard">
            <strong>No pending DB approvals</strong>
            <span>Run a database-backed simulation to create approval requests.</span>
          </article>
        )}
      </div>
    </section>
  );
}
