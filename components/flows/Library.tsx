"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { listFlows, saveFlow } from "../../lib/api/client";
import { starterFlowTemplate } from "../../lib/catalog/templates";
import { formatCents } from "../mock-data";
import type { LibraryTab, PersistedWorkflow } from "../../lib/types";
import { Button, Card, Data, DetailBlock, EmptyState, PageHeader, Pill, SkeletonGrid } from "../layout/primitives";
import { useToast } from "../layout/Toast";
import { FlowGraph } from "../build/FlowGraph";
import { savedWorkflowToGraph } from "../build/flow-graph";

// Flows is a single view: the saved-flows list + flow detail (read-only graph).
// The former My Agents / My Tools / Scoped Access tabs were removed — My Agents
// duplicated Store, per-flow tool grants belong in flow detail / Control, and
// Scoped Access was cut in Chunk 3. tab/setTab/spend remain in the signature
// (the parent still owns that state) but are no longer used here.
export function Library({ spend }: { tab: LibraryTab; setTab: (tab: LibraryTab) => void; spend: number }) {
  const { data: session } = useSession();
  const toast = useToast();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [loadingSavedWorkflows, setLoadingSavedWorkflows] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState("");

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    setLoadingSavedWorkflows(true);

    try {
      const data = await listFlows("Unable to load saved Flows.");
      setSavedWorkflows(data.workflows ?? []);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to load saved Flows.", "danger");
    } finally {
      setLoadingSavedWorkflows(false);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
  }, [session?.user?.email]);

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      toast("Sign in with Google to save Flows to your AgentDock profile.", "warn");
      return;
    }

    setSavingWorkflow(true);

    try {
      await saveFlow(starterFlowTemplate, "Flow save failed.");
      toast("Flow saved to your AgentDock profile.", "ok");
      await loadSavedWorkflows();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Flow save failed.", "danger");
    } finally {
      setSavingWorkflow(false);
    }
  };

  const visibleWorkflows = session?.user ? savedWorkflows : [];
  const selectedWorkflow = visibleWorkflows.find((workflow) => workflow.id === selectedFlowId) ?? visibleWorkflows[0];
  void spend;

  return (
    <section className="platformPage libraryPage">
      <PageHeader eyebrow="Flows" title="Flows" copy="Saved agent systems you can run, edit, or pause." />

      <div className="libraryGrid">
          <div className="flowCardColumn">
            <div className="panelHeader">
              <span>My Flows</span>
              <strong>{session?.user ? `${visibleWorkflows.length} saved` : "Demo"}</strong>
            </div>
            {loadingSavedWorkflows && <SkeletonGrid count={4} />}
            {!session?.user && (
              <EmptyState
                title="No saved Flows in demo mode"
                body="Sign in to save Flows. You can still plan and preview drafts in Build."
              />
            )}
            {session?.user && !loadingSavedWorkflows && visibleWorkflows.length === 0 && (
              <EmptyState
                title="No flows yet"
                body="Describe a goal in Build and AgentDock will plan one."
                action={<Button onClick={saveWorkflowToProfile} loading={savingWorkflow}>Load starter template</Button>}
              />
            )}
            <div className="flowCardGrid">
              {visibleWorkflows.map((workflow) => (
                <button
                  className={`flowCard${workflow.id === selectedWorkflow?.id ? " selected" : ""}`}
                  key={workflow.id}
                  onClick={() => setSelectedFlowId(workflow.id)}
                >
                  <div className="flowCardTop">
                    <strong>{workflow.name}</strong>
                    <Pill tone={workflow.status === "active" ? "ok" : "neutral"}>{workflow.status}</Pill>
                  </div>
                  <div className="flowCardMeta">
                    <Data>{workflow.workflowAgents.length} agents</Data>
                    <Data>{workflow.workflowMcps?.length ?? 0} tools</Data>
                  </div>
                </button>
              ))}
            </div>
            {session?.user && visibleWorkflows.length > 0 && (
              <div className="heroActions compactActions">
                <Button variant="ghost" onClick={saveWorkflowToProfile} loading={savingWorkflow}>Load starter template</Button>
              </div>
            )}
          </div>
          <Card title="Flow detail" meta={selectedWorkflow?.name ?? "Template"}>
            {selectedWorkflow && (
              <div className="flowDetailGraph">
                <FlowGraph input={savedWorkflowToGraph(selectedWorkflow)} readOnly />
              </div>
            )}
            <div className="detailGrid">
              <DetailBlock label="Goal" value={selectedWorkflow?.goal ?? "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval."} />
              <DetailBlock label="Agents" value={selectedWorkflow?.workflowAgents?.map((workflowAgent) => workflowAgent.agent.name).join(" → ") || "Discovery → Research → Resume → Outreach"} />
              <DetailBlock label="Tools" value={selectedWorkflow?.workflowMcps?.length ? selectedWorkflow.workflowMcps.map((mcp) => mcp.mcpServer.displayName).join(", ") : "No tools attached yet"} />
              <DetailBlock label="Budget" value={`${formatCents(selectedWorkflow?.weeklyBudgetCents ?? 500)} weekly cap`} />
              <DetailBlock label="Runtime mode" value="AgentDock Sandbox Mode" />
            </div>
          </Card>
        </div>
    </section>
  );
}
