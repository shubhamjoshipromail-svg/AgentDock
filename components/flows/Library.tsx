"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { listFlows, patchToolGrant, revokeToolGrant, saveFlow } from "../../lib/api/client";
import { starterFlowTemplate } from "../../lib/catalog/templates";
import { formatCents, workflowAgents } from "../mock-data";
import type { LibraryTab, PersistedMcpAccessGrant, PersistedWorkflow } from "../../lib/types";
import { Button, Card, CapabilityBadge, Data, DetailBlock, EmptyState, PageHeader, Pill } from "../layout/primitives";
import { FlowGraph } from "../build/FlowGraph";
import { savedWorkflowToGraph } from "../build/flow-graph";
import { KeysBilling } from "./KeysBilling";

export function Library({ tab, setTab, spend }: { tab: LibraryTab; setTab: (tab: LibraryTab) => void; spend: number }) {
  const { data: session } = useSession();
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [loadingSavedWorkflows, setLoadingSavedWorkflows] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [updatingMcpGrantId, setUpdatingMcpGrantId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState("");

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    setLoadingSavedWorkflows(true);
    setWorkflowMessage("");

    try {
      const data = await listFlows("Unable to load saved Flows.");
      setSavedWorkflows(data.workflows ?? []);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to load saved Flows.");
    } finally {
      setLoadingSavedWorkflows(false);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
  }, [session?.user?.email]);

  const saveWorkflowToProfile = async () => {
    if (!session?.user) {
      setWorkflowMessage("Sign in with Google to save Flows to your AgentDock profile.");
      return;
    }

    setSavingWorkflow(true);
    setWorkflowMessage("");

    try {
      await saveFlow(starterFlowTemplate, "Flow save failed.");
      setWorkflowMessage("Flow saved to your AgentDock profile.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Flow save failed.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  const visibleWorkflows = session?.user ? savedWorkflows : [];
  const selectedWorkflow = visibleWorkflows.find((workflow) => workflow.id === selectedFlowId) ?? visibleWorkflows[0];
  const installedAgents = visibleWorkflows.flatMap((workflow) => workflow.workflowAgents.map((workflowAgent) => workflowAgent.agent));
  const attachedMcps = visibleWorkflows.flatMap((workflow) => workflow.workflowMcps ?? []);

  const updateWorkflowMcpGrant = async (grant: PersistedMcpAccessGrant, field: "canRead" | "canWrite" | "canExecute" | "canDelete" | "requiresApproval") => {
    setUpdatingMcpGrantId(grant.id);
    setWorkflowMessage("");

    try {
      await patchToolGrant(grant.id, { [field]: !grant[field] }, "Unable to update tool access.");
      setWorkflowMessage("Tool access updated and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to update tool access.");
    } finally {
      setUpdatingMcpGrantId("");
    }
  };

  const revokeWorkflowMcpGrant = async (grant: PersistedMcpAccessGrant) => {
    setUpdatingMcpGrantId(grant.id);
    setWorkflowMessage("");

    try {
      await revokeToolGrant(grant.id, "Unable to revoke tool.");
      setWorkflowMessage("Tool revoked and logged.");
      await loadSavedWorkflows();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unable to revoke tool.");
    } finally {
      setUpdatingMcpGrantId("");
    }
  };

  return (
    <section className="platformPage libraryPage">
      <PageHeader eyebrow="Flows" title="Flows" copy="Saved agent systems you can run, edit, or pause." />
      {workflowMessage && <div className="profileAuthNotice">{workflowMessage}</div>}
      <div className="tabRow">
        {(["My Flows", "My Agents", "My Tools", "Scoped Access"] as LibraryTab[]).map((item) => (
          <button className={tab === item ? "tabButton active" : "tabButton"} key={item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>

      {tab === "My Flows" && (
        <div className="libraryGrid">
          <div className="flowCardColumn">
            <div className="panelHeader">
              <span>My Flows</span>
              <strong>{session?.user ? `${visibleWorkflows.length} saved` : "Demo"}</strong>
            </div>
            {loadingSavedWorkflows && <EmptyState title="Loading Flows…" body="Reading your saved Flows from Postgres." />}
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
      )}

      {tab === "My Agents" && (
        <div className="agentGrid compactStoreGrid">
          {(session?.user && installedAgents.length ? installedAgents : workflowAgents).map((agent) => (
            <article className="agentCard compactAgentCard" key={agent.name}>
              <div className="agentTopline">
                <span className="verifiedBadge">Used in Flow</span>
                <CapabilityBadge kind={session?.user ? "db" : "mock"} />
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.provider} - {agent.category}</p>
            </article>
          ))}
        </div>
      )}

      {tab === "My Tools" && (
        <div className="libraryGrid">
          <Card title="Tools" meta={`${attachedMcps.length} scoped`}>
            {attachedMcps.length ? attachedMcps.map((workflowMcp) => {
                const grant = selectedWorkflow?.mcpAccessGrants?.find((item) => item.mcpServer.id === workflowMcp.mcpServer.id);
                return (
                  <div className="mcpWorkflowAttachment" key={workflowMcp.id}>
                    <div>
                      <strong>{workflowMcp.mcpServer.displayName}</strong>
                      <span>{workflowMcp.purpose ?? "Flow-scoped tool metadata"}</span>
                    </div>
                    <span>{workflowMcp.defaultPermission.replaceAll("_", " ")} - {workflowMcp.mcpServer.riskLevel} risk - {grant?.requiresApproval ? "approval required" : "no approval"}</span>
                    {grant && (
                      <>
                        <div className="grantToggleGrid">
                          {([
                            ["canRead", "read"],
                            ["canWrite", "write"],
                            ["canExecute", "execute"],
                            ["canDelete", "delete"],
                            ["requiresApproval", "approval"]
                          ] as const).map(([field, label]) => (
                            <button className={grant[field] ? "grantToggle active" : "grantToggle"} disabled={updatingMcpGrantId === grant.id} key={field} onClick={() => updateWorkflowMcpGrant(grant, field)}>
                              {label}
                            </button>
                          ))}
                        </div>
                        {confirmRevokeId === grant.id ? (
                          <div className="confirmRow">
                            <p>Revoke access? The next action under this grant will be blocked.</p>
                            <Button variant="danger" size="sm" loading={updatingMcpGrantId === grant.id} onClick={() => { setConfirmRevokeId(""); revokeWorkflowMcpGrant(grant); }}>Revoke access</Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeId("")}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="buttonPair">
                            <Button variant="secondary" size="sm" disabled={updatingMcpGrantId === grant.id} onClick={() => updateWorkflowMcpGrant(grant, "requiresApproval")}>Edit access</Button>
                            <Button variant="danger" size="sm" onClick={() => setConfirmRevokeId(grant.id)}>Revoke access</Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }) : <div className="approvalItem">No DB-backed tools yet. Add one from Store or Build.</div>}
          </Card>
        </div>
      )}

      {tab === "Scoped Access" && (
        <div className="libraryGrid">
          <KeysBilling spend={spend} />
        </div>
      )}
    </section>
  );
}
