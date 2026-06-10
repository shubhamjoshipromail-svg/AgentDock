"use client";

import type { AuditEvent, CapabilityKind } from "../../lib/types";

export function PageHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="sectionHeader pageHeader">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

export function Card({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="panelHeader"><span>{title}</span><strong>{meta}</strong></div>
      {children}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

export function Metric({ label, value }: { label: string; value: string }) {
  return <span className="metric"><span>{label}</span><strong>{value}</strong></span>;
}

export function CapabilityBadge({ kind, label }: { kind: CapabilityKind; label?: string }) {
  const labels: Record<CapabilityKind, string> = {
    db: "DB-backed",
    local: "Local preview",
    soon: "Coming soon",
    mock: "Mock fallback"
  };

  return <span className={`capabilityBadge ${kind}`}>{label ?? labels[kind]}</span>;
}

export function ComingSoonButton({ children, className = "secondaryButton smallButton" }: { children: React.ReactNode; className?: string }) {
  return (
    <button className={`${className} comingSoonButton`} disabled>
      {children} · Coming soon
    </button>
  );
}

export function WorkflowMini({ name, status, budget }: { name: string; status: string; budget: string }) {
  return (
    <div className="compactItem">
      <div><strong>{name}</strong><span>{budget}</span></div>
      <span className={status === "Active" ? "statusPill running" : "statusPill awaitingapproval"}>{status}</span>
    </div>
  );
}

export function AuditList({ events, compact = false }: { events: AuditEvent[]; compact?: boolean }) {
  return (
    <div className={compact ? "timeline compactTimeline" : "timeline"}>
      {events.map((event, index) => (
        <div className="timelineEvent" key={`${event.event}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{event.event}</p>
        </div>
      ))}
    </div>
  );
}

export function DetailBlock({ label, value }: { label: string; value: string }) {
  return <div className="detailBlock"><span>{label}</span><strong>{value}</strong></div>;
}
