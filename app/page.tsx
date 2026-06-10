"use client";

import { useEffect, useMemo, useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";

import { bootstrap } from "../lib/api/client";
import { Builder } from "../components/build/Builder";
import { ControlPlane } from "../components/control/ControlPlane";
import { Library } from "../components/flows/Library";
import { Nav } from "../components/layout/Nav";
import { Profile } from "../components/profile/Profile";
import { Store } from "../components/store/Store";
import {
  builderSimulateEvents,
  baseAuditEvents,
  recommendedBuilderNodes,
  simulatedRunEvents
} from "../lib/mock-data";
import type {
  AuditEvent,
  BuilderNode,
  BuilderPaletteTab,
  LibraryTab,
  Section,
  StoreTab
} from "../lib/types";

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
    return null;
  }

  return <>{children}</>;
}

export default function Home() {
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
  const [events, setEvents] = useState<AuditEvent[]>(baseAuditEvents);
  const [spend, setSpend] = useState(2.15);
  const [runCount, setRunCount] = useState(0);
  const [runHistory, setRunHistory] = useState<string[]>([
    "Initial demo run: 12 roles searched, 3 companies summarized, 2 approval gates opened."
  ]);

  const pendingApprovals = useMemo(
    () => events.filter((event) => event.decision === "approval_required").length + 3,
    [events]
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeSection]);

  const runDemoWorkflow = () => {
    setRunCount((count) => count + 1);
    setSpend((value) => Number((value + 0.64).toFixed(2)));
    setRunHistory((current) => [
      `Run ${runCount + 1}: 12 roles searched, 3 companies summarized, resume draft and 3 Gmail drafts queued for approval.`,
      ...current
    ]);
    setEvents((current) => [
      ...simulatedRunEvents.map((event, index) => ({
        ...event,
        event: runCount > 0 ? `${event.event} (run ${runCount + 1})` : event.event,
        cost: index === 0 && runCount > 0 ? "$0.10" : event.cost
      })),
      ...current
    ]);
    setActiveSection("Control");
  };

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
    setRunHistory((current) => [
      `Builder saved Job Search Automation with ${builderNodes.length} components, $5/week cap, and approval-gated sends/applications.`,
      ...current
    ]);
  };

  const simulateBuilderRun = () => {
    setBuilderSaved(true);
    setSpend((value) => Number((value + 0.71).toFixed(2)));
    setRunCount((count) => count + 1);
    setRunHistory((current) => [
      `Builder simulation ${runCount + 1}: recommended stack ran through search, research, resume memory, Gmail draft access, and policy blocks.`,
      ...current
    ]);
    setEvents((current) => [
      ...builderSimulateEvents.map((event) => ({
        ...event,
        event: runCount > 0 ? `${event.event} (builder run ${runCount + 1})` : event.event
      })),
      ...current
    ]);
  };

  const simulateUnsafeAction = () => {
    setEvents((current) => [
      {
        event: "Outreach Draft Agent attempted to send email - blocked by Policy Engine and added to Approval Inbox",
        type: "blocked action",
        agent: "Outreach Draft Agent",
        workflow: "Job Search Automation",
        tool: "Gmail Draft MCP",
        permission: "send email",
        memory: "Job Search Memory",
        cost: "$0.00",
        decision: "approval_required"
      },
      ...current
    ]);
  };

  return (
    <SessionProvider>
      <main className="shell platformShell">
      <Nav activeSection={activeSection} onSelectSection={setActiveSection} />

      <BootstrapGate>
      {activeSection === "Control" && (
        <ControlPlane
          events={events}
          spend={spend}
          pendingApprovals={pendingApprovals}
          defaultAgent={defaultAgent}
          runHistory={runHistory}
          onRun={runDemoWorkflow}
          onOpenSection={setActiveSection}
        />
      )}
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
          onSimulate={simulateBuilderRun}
          onUnsafeSimulate={simulateUnsafeAction}
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
      </main>
    </SessionProvider>
  );
}
