"use client";

// A2UI — agent-to-user interface. Every agent-originated event reaches the human
// through ONE card anatomy: who · what · on what · authority · decision · when/cost.
import type { AuditEvent, Decision, McpRiskLevel, PersistedApprovalRequest, PersistedWorkflowRunEvent } from "../../lib/types";
import { Badge, Button, Data } from "../layout/primitives";

export type A2UIEvent = {
  id: string;
  who: string;
  what: string;
  resource?: string;
  resourceRisk?: McpRiskLevel;
  authority?: string;
  decision: Decision;
  timestamp?: string;
  costCents?: number;
  eventType: string;
};

const DECISION_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  allowed: "ok",
  approved: "ok",
  approval_required: "warn",
  blocked: "danger",
  denied: "danger",
  info: "neutral"
};

const DECISION_LABEL: Record<string, string> = {
  allowed: "allowed",
  approved: "approved",
  approval_required: "approval required",
  blocked: "blocked",
  denied: "denied",
  info: "info"
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export function EventCard({ event }: { event: A2UIEvent }) {
  const tone = DECISION_TONE[event.decision] ?? "neutral";
  return (
    <article className={`ec ec-stripe-${tone}`}>
      <div className="ecMain">
        <div className="ecWho">
          <span className="ecAvatar" aria-hidden>{initials(event.who)}</span>
          <span className="ecWhoName">{event.who}</span>
        </div>
        <p className="ecWhat">{event.what}</p>
        <div className="ecMeta">
          {event.resource && (
            <span className="ecResource">
              {event.resource}
              {event.resourceRisk && <Badge risk={event.resourceRisk} />}
            </span>
          )}
          {event.authority && <Data className="ecAuthority">{event.authority}</Data>}
        </div>
      </div>
      <div className="ecAside">
        <Badge decision={event.decision} tone={tone}>{DECISION_LABEL[event.decision] ?? event.decision}</Badge>
        <div className="ecWhen">
          {event.timestamp && <Data>{formatTime(event.timestamp)}</Data>}
          {typeof event.costCents === "number" && <Data>{formatCents(event.costCents)}</Data>}
        </div>
      </div>
    </article>
  );
}

// The signature variant: an approval the human must resolve. Same anatomy + a
// rationale line + an action row. Pending cards pulse warn until resolved.
export function ApprovalCard({
  approval,
  onResolve,
  resolving = false
}: {
  approval: PersistedApprovalRequest;
  onResolve?: (id: string, status: "approved" | "denied" | "edited") => void;
  resolving?: boolean;
}) {
  return (
    <article className="ec ec-stripe-warn ec-approval">
      <div className="ecMain">
        <div className="ecWho">
          <span className="ecAvatar" aria-hidden>{initials(approval.agent?.name ?? "System")}</span>
          <span className="ecWhoName">{approval.agent?.name ?? "System"}</span>
        </div>
        <p className="ecWhat">{approval.title}</p>
        <div className="ecMeta">
          <span className="ecResource">{approval.actionType.replaceAll("_", " ")}<Badge tone="warn">{approval.riskLevel} risk</Badge></span>
        </div>
        {approval.description && <p className="ecRationale">{approval.description}</p>}
        <div className="ecActions">
          <Button variant="primary" size="sm" loading={resolving} onClick={() => onResolve?.(approval.id, "approved")}>Approve</Button>
          <Button variant="danger" size="sm" disabled={resolving} onClick={() => onResolve?.(approval.id, "denied")}>Deny</Button>
          <Button variant="ghost" size="sm" disabled={resolving} onClick={() => onResolve?.(approval.id, "edited")}>Edit policy</Button>
        </div>
        <p className="ecRationale">Approve resumes only after a fresh policy check. Edit policy does not execute the action.</p>
      </div>
      <div className="ecAside">
        <Badge tone="warn">approval required</Badge>
        <div className="ecWhen"><Data>{formatTime(approval.requestedAt)}</Data></div>
      </div>
    </article>
  );
}

// ---- Normalizers: legacy mock + DB run events -> the one grammar ----

export function auditEventToA2UI(event: AuditEvent, index: number): A2UIEvent {
  return {
    id: `audit-${index}-${event.event}`,
    who: event.agent,
    what: event.event,
    resource: event.tool !== "None" ? event.tool : event.memory !== "None" ? event.memory : undefined,
    authority: event.permission,
    decision: event.decision,
    costCents: undefined,
    eventType: event.type
  };
}

export function runEventToA2UI(event: PersistedWorkflowRunEvent): A2UIEvent {
  return {
    id: event.id,
    who: event.agent?.name ?? "System",
    what: event.title,
    resource: event.mcpTool ?? event.memoryPartition?.name ?? undefined,
    authority: event.eventType.replaceAll("_", " "),
    decision: event.decision ?? "info",
    timestamp: event.createdAt,
    costCents: event.costCents,
    eventType: event.eventType
  };
}
