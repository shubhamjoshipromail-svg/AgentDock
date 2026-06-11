"use client";

import { sections } from "../mock-data";
import type { Section } from "../../lib/types";
import { AuthStatus } from "./AuthMenu";

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
      <AuthStatus />
    </nav>
  );
}
