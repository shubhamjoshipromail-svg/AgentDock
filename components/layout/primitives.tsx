"use client";

import { useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/ui/cn";
import type { CapabilityKind, McpRiskLevel, McpVerificationStatus, Decision } from "../../lib/types";

// Logo-led object identity: a rounded square. The glyph renders first and stays
// as the fallback; the favicon/avatar image overlays it and is removed on error,
// so it degrades gracefully offline.
export function Logo({ src, label, glyph }: { src?: string; label: string; glyph?: React.ReactNode }) {
  const [ok, setOk] = useState(Boolean(src));
  return (
    <span className="objLogo" aria-hidden>
      <span className="objLogoGlyph">{glyph ?? label.slice(0, 1).toUpperCase()}</span>
      {src && ok && <img className="objLogoImg" src={src} alt="" loading="lazy" onError={() => setOk(false)} />}
    </span>
  );
}

// Deterministic initial avatar, tinted in the accent's neighborhood (no rainbow).
export function Avatar({ name }: { name: string }) {
  const hash = name.split("").reduce((acc, ch) => ch.charCodeAt(0) + ((acc << 5) - acc), 0);
  const hue = 200 + (Math.abs(hash) % 56); // 200–256: blue → violet, near the accent
  return (
    <span className="objAvatar" aria-hidden style={{ background: `hsl(${hue} 38% 22%)`, color: `hsl(${hue} 58% 78%)` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Design-system primitives. Every primitive consumes tokens (app/tokens.css)
// via class names defined in primitives.css — no caller ever picks a color.
// ---------------------------------------------------------------------------

// Variant machinery via cva (shadcn convention) over the token-driven classes
// from primitives.css — same rendered output as before, structured variants now.
export const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn-primary",
      secondary: "btn-secondary",
      ghost: "btn-ghost",
      danger: "btn-danger"
    },
    size: {
      sm: "btn-sm",
      md: "btn-md"
    }
  },
  defaultVariants: { variant: "secondary", size: "md" }
});

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export function Button({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  type = "button",
  ...rest
}: {
  children: React.ReactNode;
  loading?: boolean;
} & VariantProps<typeof buttonVariants> &
  React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), loading && "btn-loading", className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden /> : children}
    </button>
  );
}

export function Card({
  title,
  meta,
  header,
  className = "",
  children
}: {
  title?: string;
  meta?: string;
  header?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card ${className}`.trim()}>
      {header ? (
        <div className="cardHeader">{header}</div>
      ) : title ? (
        <div className="panelHeader"><span>{title}</span>{meta && <strong>{meta}</strong>}</div>
      ) : null}
      {children}
    </div>
  );
}

// Inline mono element for machine-true values (IDs, costs, tokens, timestamps).
export function Data({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`data ${className}`.trim()}>{children}</span>;
}

// Risk / verification / decision colors resolve internally. Always carries text.
export function Badge({
  risk,
  verification,
  decision,
  tone,
  children
}: {
  risk?: McpRiskLevel;
  verification?: McpVerificationStatus;
  decision?: Decision;
  tone?: "ok" | "warn" | "danger" | "restricted" | "accent" | "neutral";
  children?: React.ReactNode;
}) {
  let resolved: string = tone ?? "neutral";
  let label = children;

  if (risk) {
    resolved = risk === "low" ? "ok" : risk === "medium" ? "warn" : risk === "high" ? "danger" : "restricted";
    label = label ?? `${risk} risk`;
  } else if (verification) {
    resolved = verification === "verified" ? "ok" : verification === "community" ? "warn" : "unverified";
    label = label ?? verification;
  } else if (decision) {
    resolved =
      decision === "allowed" || decision === "approved"
        ? "ok"
        : decision === "approval_required"
          ? "warn"
          : decision === "blocked" || decision === "denied"
            ? "danger"
            : "neutral";
    label = label ?? decision.replaceAll("_", " ");
  }

  return <span className={`badge badge-${resolved}`}>{label}</span>;
}

export function Pill({
  tone = "neutral",
  title,
  children
}: {
  tone?: "ok" | "warn" | "danger" | "accent" | "neutral";
  title?: string;
  children: React.ReactNode;
}) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function Input({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field ${className}`.trim()} {...rest} />;
}

export function Select({ className = "", children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`field ${className}`.trim()} {...rest}>{children}</select>;
}

export function SearchInput({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`searchInput ${className}`.trim()}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input type="search" {...rest} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="emptyState">
      {icon && <div className="emptyStateIcon" aria-hidden>{icon}</div>}
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return <span className="metric"><span>{label}</span><strong className="data">{value}</strong></span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`.trim()} aria-hidden />;
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="skeletonGrid" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="skeletonCard" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy primitives kept working (restyled via tokens). Callers migrate as
// later phases touch each surface.
// ---------------------------------------------------------------------------

// Section context (eyebrow + title) now lives in the shell top bar. PageHeader
// keeps only the one-line lede so surfaces don't repeat their own heading.
export function PageHeader({ copy }: { eyebrow?: string; title?: string; copy: string }) {
  return (
    <div className="sectionLede">
      <p>{copy}</p>
    </div>
  );
}

export function CapabilityBadge({ kind, label }: { kind: CapabilityKind; label?: string }) {
  const labels: Record<CapabilityKind, string> = {
    db: "DB-backed",
    local: "Local preview",
    soon: "Coming soon",
    mock: "Demo"
  };

  return <span className={`capabilityBadge ${kind}`}>{label ?? labels[kind]}</span>;
}

// ---------------------------------------------------------------------------
// Radix-backed primitives (accessibility + keyboard behavior for free),
// themed entirely from tokens — never the default look.
// ---------------------------------------------------------------------------

export function Tooltip({
  content,
  side = "top",
  children
}: {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="tooltip" side={side} sideOffset={6}>
            {content}
            <TooltipPrimitive.Arrow className="tooltipArrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className = ""
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: React.ReactNode }[];
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cn("tabs", className)}>
      <TabsPrimitive.List className="tabsList" aria-label="Tabs">
        {items.map((item) => (
          <TabsPrimitive.Trigger key={item.value} value={item.value} className="tabsTrigger">
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export const TabsContent = TabsPrimitive.Content;

// Disabled action with an explanatory tooltip. No bespoke class — it is just a
// disabled Button, so its state reads the same as every other disabled control.
export function ComingSoonButton({ children, size = "sm" }: { children: React.ReactNode; size?: ButtonSize }) {
  return (
    <Button size={size} disabled title="Coming soon">
      {children}
    </Button>
  );
}

export function DetailBlock({ label, value }: { label: string; value: string }) {
  return <div className="detailBlock"><span>{label}</span><strong>{value}</strong></div>;
}
