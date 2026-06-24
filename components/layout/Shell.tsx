"use client";

import { useSession } from "next-auth/react";

import { sections } from "../mock-data";
import type { Section } from "../../lib/types";
import { Pill } from "./primitives";
import { AuthStatus } from "./AuthMenu";

// Section glyphs — inline SVG only, 18px, stroke = currentColor.
function SectionIcon({ section }: { section: Section }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (section) {
    case "Workspace":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M9 3v18" /><path d="M3 9h18" /></svg>;
    case "Store":
      return <svg {...common}><path d="M4 8h16l-1 4.5a3 3 0 0 1-3 2.5H8a3 3 0 0 1-3-2.5Z" /><path d="M4 8 6 4h12l2 4" /><path d="M9 19h6" /></svg>;
    case "Guides":
      return <svg {...common}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" /><path d="M8 7h6" /><path d="M8 11h8" /><path d="M8 15h6" /></svg>;
    case "Profile":
      return <svg {...common}><circle cx="12" cy="8.5" r="3.3" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></svg>;
  }
}

function ModeIndicator() {
  const { data: session, status } = useSession();
  if (status === "loading") return null;
  const signedIn = Boolean(session?.user);
  return (
    <Pill
      tone={signedIn ? "ok" : "warn"}
      title={signedIn ? "Signed in. Flows, runs, and approvals persist to Postgres." : "Signed-out demo shows sample data. Sign in to persist."}
    >
      {signedIn ? "DB-backed" : "Demo"}
    </Pill>
  );
}

const SECTION_TITLES: Record<Section, string> = {
  Workspace: "Workspace",
  Store: "Store",
  Guides: "Guides",
  Profile: "Profile"
};

export function Shell({
  activeSection,
  onSelectSection,
  onOpenCommand,
  actions,
  children
}: {
  activeSection: Section;
  onSelectSection: (section: Section) => void;
  onOpenCommand: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="appFrame">
      <aside className="rail" aria-label="Primary">
        <div className="railBrand">
          <span className="brandMark">AD</span>
        </div>
        <nav className="railNav" aria-label="Sections">
          {sections.map((section) => (
            <button
              key={section}
              className={activeSection === section ? "railLink active" : "railLink"}
              onClick={() => onSelectSection(section)}
              aria-current={activeSection === section ? "page" : undefined}
            >
              <SectionIcon section={section} />
              <span>{section}</span>
            </button>
          ))}
        </nav>
        <div className="railFoot">
          <ModeIndicator />
          <AuthStatus />
        </div>
      </aside>
      <div className="workMain">
        <header className="topBar">
          <h1 className="topBarTitle">{SECTION_TITLES[activeSection]}</h1>
          <div className="topBarActions">
            {actions}
            <button className="cmdkHint" onClick={onOpenCommand} title="Command palette">
              <span>Search</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </header>
        <div className="workContent">{children}</div>
      </div>
    </div>
  );
}
