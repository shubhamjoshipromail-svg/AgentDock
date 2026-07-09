"use client";

import { useMemo, useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";

import { bootstrap } from "../lib/api/client";
import { Shell } from "../components/layout/Shell";
import { FlowWorkspace } from "../components/workspace/FlowWorkspace";
import { Profile } from "../components/profile/Profile";
import { Store } from "../components/store/Store";
import { CommandPalette, type Command } from "../components/layout/CommandPalette";
import { ToastProvider } from "../components/layout/Toast";
import { AttentionProvider, AttentionBanner, AttentionWindow } from "../components/attention/AttentionCenter";
import type { Section, StoreTab } from "../lib/types";
import { useEffect } from "react";

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { setReady(true); return; }
    let cancelled = false;
    bootstrap().catch(() => undefined).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [status, session?.user?.email]);

  if (!ready) return <div className="sectionLoading" aria-busy="true">Loading workspace…</div>;
  return <>{children}</>;
}

function AppInner() {
  const [activeSection, setActiveSection] = useState<Section>("Workspace");
  const [workspaceFlowId, setWorkspaceFlowId] = useState<string | null>(null);
  const [storeTab, setStoreTab] = useState<StoreTab>("Agents");
  const [defaultAgent, setDefaultAgent] = useState("Job Discovery Agent");
  const [cmdkOpen, setCmdkOpen] = useState(false);

  const commands: Command[] = useMemo(() => {
    const go = (section: Section): Command => ({
      id: `go-${section}`, label: `Go to ${section}`, group: "Navigation", hint: "Navigate", run: () => setActiveSection(section)
    });
    return [
      go("Workspace"), go("Store"), go("Guides"), go("Profile"),
      { id: "new-flow", label: "New flow", group: "Actions", hint: "Workspace", run: () => setActiveSection("Workspace") },
    ];
  }, []);

  return (
    <>
      {/* Global attention surface: finds you on ANY screen when a run is
          waiting on you. Reads the same pending-intents state as the queue
          and the focused window — never a separate store. */}
      <AttentionBanner />
      <AttentionWindow />
      <Shell activeSection={activeSection} onSelectSection={setActiveSection} onOpenCommand={() => setCmdkOpen(true)}>
        <BootstrapGate>
          {activeSection === "Workspace" && (
            <FlowWorkspace flowId={workspaceFlowId} onFlowChange={setWorkspaceFlowId} />
          )}
          {activeSection === "Store" && (
            <Store tab={storeTab} setTab={setStoreTab} defaultAgent={defaultAgent} setDefaultAgent={setDefaultAgent} />
          )}
          {activeSection === "Guides" && (
            <div style={{ padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Guides</h2>
              <p style={{ color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.6 }}>
                Templates and walkthroughs for common flows — coming soon. For now, describe a task in the Workspace
                and the orchestrator will compose a flow for you.
              </p>
            </div>
          )}
          {activeSection === "Profile" && (
            <Profile selectedMemory="Job Search Memory" onSelectMemory={() => {}} defaultAgent={defaultAgent} />
          )}
        </BootstrapGate>
      </Shell>
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} commands={commands} />
    </>
  );
}

export default function Home() {
  return (
    <SessionProvider>
      <ToastProvider>
        <AttentionProvider>
          <AppInner />
        </AttentionProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
