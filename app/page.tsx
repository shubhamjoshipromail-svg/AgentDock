"use client";

import { useMemo, useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";

import { bootstrap } from "../lib/api/client";
import { Builder } from "../components/build/Builder";
import { ControlPlane } from "../components/control/ControlPlane";
import { Library } from "../components/flows/Library";
import { Shell } from "../components/layout/Shell";
import { Profile } from "../components/profile/Profile";
import { Store } from "../components/store/Store";
import { CommandPalette, type Command } from "../components/layout/CommandPalette";
import { ToastProvider } from "../components/layout/Toast";
import { recommendedBuilderNodes } from "../components/mock-data";
import type {
  BuilderNode,
  BuilderPaletteTab,
  LibraryTab,
  Section,
  StoreTab
} from "../lib/types";
import { useEffect } from "react";

// Runs the idempotent server bootstrap once per signed-in session before the
// sections mount, so their initial loads see the starter data (GET routes are
// pure reads). Children render immediately when signed out.
function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (!session?.user) {
      setReady(true);
      return;
    }

    let cancelled = false;
    bootstrap()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.email]);

  if (!ready) {
    return <div className="sectionLoading" aria-busy="true">Loading workspace…</div>;
  }

  return <>{children}</>;
}

function AppInner() {
  const [activeSection, setActiveSection] = useState<Section>("Build");
  const [storeTab, setStoreTab] = useState<StoreTab>("Agents");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("My Flows");
  const [builderPaletteTab, setBuilderPaletteTab] = useState<BuilderPaletteTab>("Agents");
  const [builderPrompt, setBuilderPrompt] = useState("Find jobs, research companies, tailor resumes, and draft outreach. Do not send or apply without me.");
  const [builderNodes, setBuilderNodes] = useState<BuilderNode[]>([recommendedBuilderNodes[0]]);
  const [selectedBuilderNodeId, setSelectedBuilderNodeId] = useState(recommendedBuilderNodes[0].id);
  const [builderSaved, setBuilderSaved] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState("Job Search Memory");
  const [defaultAgent, setDefaultAgent] = useState("Job Discovery Agent");
  const [spend] = useState(2.15);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  const recommendBuilderStack = () => {
    setBuilderNodes(recommendedBuilderNodes);
    setSelectedBuilderNodeId("agent-job-discovery");
    setBuilderSaved(false);
  };

  const addBuilderNode = (node: BuilderNode) => {
    setBuilderNodes((current) => {
      const uniqueId = `${node.id}-${current.length + 1}`;
      const nextNode = current.some((item) => item.id === node.id) ? { ...node, id: uniqueId } : node;
      setSelectedBuilderNodeId(nextNode.id);
      return [...current, nextNode];
    });
    setBuilderSaved(false);
  };

  const removeBuilderNode = (id: string) => {
    setBuilderNodes((current) => {
      const next = current.filter((node) => node.id !== id || node.type === "goal");
      setSelectedBuilderNodeId(next[0]?.id ?? recommendedBuilderNodes[0].id);
      return next.length ? next : [recommendedBuilderNodes[0]];
    });
    setBuilderSaved(false);
  };

  const saveBuilderWorkflow = () => {
    setBuilderSaved(true);
  };

  const commands: Command[] = useMemo(() => {
    const go = (section: Section): Command => ({
      id: `go-${section}`,
      label: `Go to ${section}`,
      group: "Navigation",
      hint: "Navigate",
      run: () => setActiveSection(section)
    });
    return [
      go("Build"),
      go("Store"),
      go("Flows"),
      go("Control"),
      go("Profile"),
      { id: "new-flow", label: "New flow", group: "Actions", hint: "Build", run: () => setActiveSection("Build") },
      { id: "sync-catalog", label: "Sync catalog", group: "Actions", hint: "Store", run: () => { setActiveSection("Store"); setStoreTab("Tools"); } },
      { id: "focus-search", label: "Focus search", group: "Actions", hint: "Store", run: () => { setActiveSection("Store"); setStoreTab("Tools"); } }
    ];
  }, []);

  return (
    <>
      <Shell
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onOpenCommand={() => setCmdkOpen(true)}
      >
        <BootstrapGate>
          {activeSection === "Control" && <ControlPlane />}
          {activeSection === "Build" && (
            <Builder
              prompt={builderPrompt}
              setPrompt={setBuilderPrompt}
              nodes={builderNodes}
              selectedNodeId={selectedBuilderNodeId}
              setSelectedNodeId={setSelectedBuilderNodeId}
              saved={builderSaved}
              onRecommend={recommendBuilderStack}
              onAddNode={addBuilderNode}
              onRemoveNode={removeBuilderNode}
              onSave={saveBuilderWorkflow}
              onViewLogs={() => setActiveSection("Control")}
              onSetDefault={setDefaultAgent}
            />
          )}
          {activeSection === "Store" && (
            <Store
              tab={storeTab}
              setTab={setStoreTab}
              defaultAgent={defaultAgent}
              setDefaultAgent={setDefaultAgent}
            />
          )}
          {activeSection === "Flows" && (
            <Library
              tab={libraryTab}
              setTab={setLibraryTab}
              spend={spend}
            />
          )}
          {activeSection === "Profile" && (
            <Profile
              selectedMemory={selectedMemory}
              onSelectMemory={setSelectedMemory}
              defaultAgent={defaultAgent}
            />
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
        <AppInner />
      </ToastProvider>
    </SessionProvider>
  );
}
