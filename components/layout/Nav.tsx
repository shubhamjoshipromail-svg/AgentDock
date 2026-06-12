"use client";

import { useSession } from "next-auth/react";

import { sections } from "../mock-data";
import type { Section } from "../../lib/types";
import { Pill } from "./primitives";
import { AuthStatus } from "./AuthMenu";

// The single global mode indicator. Replaces every per-section truthNotice banner.
function ModePill() {
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

export function Nav({ activeSection, onSelectSection }: { activeSection: Section; onSelectSection: (section: Section) => void }) {
  return (
    <nav className="topbar platformTopbar" aria-label="Platform">
      <div className="brand">
        <span className="brandMark">AD</span>
        <span>AgentDock</span>
      </div>
      <div className="navLinks platformNav">
        {sections.map((section) => (
          <button
            className={activeSection === section ? "navButton active" : "navButton"}
            key={section}
            onClick={() => onSelectSection(section)}
          >
            {section}
          </button>
        ))}
      </div>
      <div className="navTrailing">
        <ModePill />
        <AuthStatus />
      </div>
    </nav>
  );
}
