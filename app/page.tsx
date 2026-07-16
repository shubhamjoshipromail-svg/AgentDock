"use client";

import { useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";

import { bootstrap } from "../lib/api/client";
import { Shell } from "../components/layout/Shell";
import { FlowWorkspace } from "../components/workspace/FlowWorkspace";
import { Profile } from "../components/profile/Profile";
import { Store } from "../components/store/Store";
import { ToastProvider } from "../components/layout/Toast";
import { AttentionProvider, AttentionBanner, AttentionWindow } from "../components/attention/AttentionCenter";
import { GettingStarted } from "../components/onboarding/GettingStarted";
import type { Section } from "../lib/types";
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

  return (
    <div className="appViewport">
      {/* TOP CHROME STACK: the attention banner lives in normal flow ABOVE the
          app frame — it pushes the shell down instead of plating over the top
          bar. Visible on ANY screen; reads the same pending-intents state as
          the queue and the focused window — never a separate store. */}
      <AttentionBanner />
      <AttentionWindow />
      <GettingStarted
        openProfile={() => setActiveSection("Profile")}
        openWorkspace={() => setActiveSection("Workspace")}
      />
      <Shell activeSection={activeSection} onSelectSection={setActiveSection}>
        <BootstrapGate>
          {activeSection === "Workspace" && (
            <FlowWorkspace
              flowId={workspaceFlowId}
              onFlowChange={setWorkspaceFlowId}
              onOpenProfile={() => setActiveSection("Profile")}
            />
          )}
          {activeSection === "Store" && (
            <Store />
          )}
          {activeSection === "Profile" && (
            <Profile selectedMemory="Job Search Memory" onSelectMemory={() => {}} />
          )}
        </BootstrapGate>
      </Shell>
    </div>
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
