"use client";

// ROADMAP (Chunk 10, finding D-2): these are AgentDock's bespoke event cards —
// every agent-originated event reaches the human through ONE card anatomy
// (who · what · on what · authority · decision · when/cost). This is working
// rendering, NOT a surface protocol. The "A2UI" identifiers here are flagged for
// an honest rename when the real **A2UI** (agent-to-user interface) protocol is
// adopted in a future chunk; behavior is unchanged for now.
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
// rationale line + editable tool arguments + an action row. Pending cards pulse
// warn until resolved.
export function ApprovalCard({
  approval,
  onResolve,
  resolving = false
}: {
  approval: PersistedApprovalRequest;
  onResolve?: (id: string, status: "approved" | "denied" | "edited", editedArgs?: Record<string, string>) => void;
  resolving?: boolean;
}) {
  const meta = approval.metadata ?? {};
  const toolArgs = (meta.arguments as Record<string, string>) ?? {};
  const hasArgs = Object.keys(toolArgs).length > 0;

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
        {approval.description && <p className="ecRationale">{approval.description.slice(0, 200)}</p>}
        {hasArgs && (
          // Read-only: the exact action that will run if approved. Approval
          // consent binds to precisely what is shown here — the server refuses to
          // execute any edited arguments (that would break "what you approved is
          // what runs"). To change the action, use "Edit policy", which halts and
          // requires a re-run that raises a fresh approval for the real action.
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", margin: "0.5rem 0" }}>
            {Object.entries(toolArgs).map(([key, value]) => (
              <div key={key} style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.72rem", color: "var(--muted)", minWidth: 50, textAlign: "right" }}>{key}:</label>
                <span style={{
                  flex: 1, background: "var(--surface)", color: "var(--foreground)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 4px)",
                  padding: "0.3rem 0.4rem", fontSize: "0.75rem", wordBreak: "break-word"
                }}>{String(value ?? "") || <span style={{ color: "var(--muted)" }}>(empty)</span>}</span>
              </div>
            ))}
          </div>
        )}
        <div className="ecActions">
          <Button variant="primary" size="sm" loading={resolving} onClick={() => onResolve?.(approval.id, "approved")}>Approve</Button>
          <Button variant="danger" size="sm" disabled={resolving} onClick={() => onResolve?.(approval.id, "denied")}>Deny</Button>
          <Button variant="ghost" size="sm" disabled={resolving} onClick={() => onResolve?.(approval.id, "edited")}>Edit policy</Button>
        </div>
        <p className="ecRationale">Approve runs exactly the action shown above. To change it, choose Edit policy — the run halts and you re-run to apply the change.</p>
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
