"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { attachToolToFlow, listFlows, listToolServers, syncToolCatalog } from "../../lib/api/client";
import { agents, mcpTools, workflowTemplates } from "../mock-data";
import type { PersistedMcpServer, PersistedWorkflow, StoreTab } from "../../lib/types";
import { CapabilityBadge, ComingSoonButton, Metric, PageHeader } from "../layout/primitives";
import { WorkflowTemplateCard } from "./WorkflowTemplateCard";

export function Store({
  tab,
  setTab,
  defaultAgent,
  setDefaultAgent
}: {
  tab: StoreTab;
  setTab: (tab: StoreTab) => void;
  defaultAgent: string;
  setDefaultAgent: (agent: string) => void;
}) {
  const { data: session } = useSession();
  const [mcpServers, setMcpServers] = useState<PersistedMcpServer[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [mcpMessage, setMcpMessage] = useState("");
  const [syncingMcp, setSyncingMcp] = useState(false);
  const [attachingMcpId, setAttachingMcpId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");

  const loadMcpServers = async () => {
    if (!session?.user) {
      setMcpServers([]);
      return;
    }

    try {
      const data = await listToolServers("Unable to load MCP catalog.");
      setMcpServers(data.servers ?? []);
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Unable to load MCP catalog. Showing mock fallback.");
      setMcpServers([]);
    }
  };

  const loadSavedWorkflows = async () => {
    if (!session?.user) {
      setSavedWorkflows([]);
      return;
    }

    try {
      const data = await listFlows("Unable to load saved Flows.");
      setSavedWorkflows(data.workflows ?? []);
    } catch {
      setSavedWorkflows([]);
    }
  };

  useEffect(() => {
    if (tab === "Tools") {
      loadMcpServers();
      loadSavedWorkflows();
    }
  }, [tab, session?.user?.email]);

  const syncMcpRegistry = async () => {
    if (!session?.user) {
      setMcpMessage("Sign in with Google to sync tool metadata into AgentDock.");
      return;
    }

    setSyncingMcp(true);
    setMcpMessage("");

    try {
      const data = await syncToolCatalog("Tool sync failed.");
      setMcpMessage(`Synced ${data.upserted} servers · ${data.skipped} skipped · ${data.failed} failed (${data.durationMs}ms)`);
      await loadMcpServers();
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Tool sync failed.");
    } finally {
      setSyncingMcp(false);
    }
  };

  const attachMcpToWorkflow = async (server: PersistedMcpServer) => {
    if (!session?.user) {
      setMcpMessage("Sign in with Google to add tools to a saved Flow.");
      return;
    }

    if (savedWorkflows.length === 0) {
      setMcpMessage("Save a Flow from Build first, then add tools to it.");
      return;
    }

    // Target the user-selected Flow. With a single Flow, use it; with several,
    // require an explicit choice rather than guessing by name.
    const workflow = selectedFlowId
      ? savedWorkflows.find((item) => item.id === selectedFlowId)
      : savedWorkflows.length === 1
        ? savedWorkflows[0]
        : undefined;

    if (!workflow?.id) {
      setMcpMessage("Select which Flow to add this tool to.");
      return;
    }

    const defaultPermission = server.recommendedPermission;
    setAttachingMcpId(server.id);
    setMcpMessage("");

    try {
      await attachToolToFlow(workflow.id, {
        mcpServerId: server.id,
        purpose: `${server.displayName} scoped to ${workflow.name}`,
        defaultPermission
      }, "Unable to add tool to Flow.");

      setMcpMessage(`${server.displayName} added to ${workflow.name} with ${defaultPermission.replaceAll("_", " ")} access.`);
      await loadSavedWorkflows();
    } catch (error) {
      setMcpMessage(error instanceof Error ? error.message : "Unable to add tool to Flow.");
    } finally {
      setAttachingMcpId("");
    }
  };

  const dbMcpAvailable = Boolean(session?.user && mcpServers.length);

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Store" title="Store" copy="Agents, tools, and templates you can add to Flows." />
      <div className="truthNotice">
        <CapabilityBadge kind={session?.user ? "db" : "mock"} />
        <strong>{session?.user ? "DB-backed mode active." : "You are in demo mode. Sign in to persist Flows, runs, approvals, memory, and tools."}</strong>
        <span>Agent and template installs are previews. Tools can be added to saved Flows.</span>
      </div>
      <div className="tabRow">
        {(["Agents", "Tools", "Templates"] as StoreTab[]).map((item) => (
          <button className={tab === item ? "tabButton active" : "tabButton"} key={item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === "Agents" && (
        <div className="agentGrid compactStoreGrid">
          {agents.map((agent, index) => (
            <article className="agentCard compactAgentCard" key={agent.name}>
              <div className="agentTopline">
                <div className="badgeGroup">
                  <span className="rankText">#{index + 1} {agent.category}</span>
                  {agent.verified && <span className="verifiedBadge">Verified</span>}
                </div>
                <div className="buttonPair">
                  <ComingSoonButton>Install</ComingSoonButton>
                  <ComingSoonButton>{defaultAgent === agent.name ? "Default" : "Set default"}</ComingSoonButton>
                </div>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.description}</p>
              <div className="agentStats compactStats">
                <Metric label="Provider" value={agent.provider} />
                <Metric label="Trust" value={`${agent.trustScore}`} />
                <Metric label="Cost/task" value={agent.costPerTask} />
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "Tools" && (
        <>
          <div className="mcpStoreIntro">
            <p>Listed does not mean trusted. AgentDock adds risk, access, Flow scope, logs, and revocation first.</p>
            <div className="buttonPair">
              {savedWorkflows.length > 1 && (
                <select
                  className="secondaryButton smallButton"
                  aria-label="Target Flow for Add Tool"
                  value={selectedFlowId}
                  onChange={(event) => setSelectedFlowId(event.target.value)}
                >
                  <option value="">Select a Flow…</option>
                  {savedWorkflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                  ))}
                </select>
              )}
              <button className="primaryButton" onClick={syncMcpRegistry} disabled={syncingMcp}>
                {syncingMcp ? "Syncing..." : "Sync Tools"}
              </button>
              <CapabilityBadge kind={session?.user ? "db" : "mock"} />
            </div>
          </div>
          {mcpMessage && <div className="profileAuthNotice">{mcpMessage}</div>}
          {!session?.user && <div className="profileAuthNotice">Signed-out demo mode: showing mock tool cards. Sign in to sync the tool catalog.</div>}
          <div className="mcpGrid compactStoreGrid">
            {dbMcpAvailable ? mcpServers.map((server) => {
              const defaultPermission = server.recommendedPermission;
              const isVerified = server.verificationStatus === "verified";
              const isCommunity = server.verificationStatus === "community";
              const isUnverified = server.verificationStatus === "unverified";
              return (
                <article className="mcpCard compactAgentCard" key={server.id}>
                  <div className="panelHeader">
                    <span>{isVerified ? "AgentDock verified" : isCommunity ? "Community" : "Official MCP Registry"}</span>
                    <strong>{server.riskLevel} risk</strong>
                  </div>
                  <div className="badgeGroup">
                    {isVerified && <span className="verifiedBadge">Verified</span>}
                    {isCommunity && <span className="rankText">Community</span>}
                    {isUnverified && <span className="rankText">Unverified</span>}
                    <span className="rankText">{server.category ?? "Uncategorized"}</span>
                  </div>
                  <h3>{server.displayName}</h3>
                  <p>{server.description}</p>
                  <Metric label="Access" value={defaultPermission.replaceAll("_", " ")} />
                  <Metric label="Tools" value={server.tools?.length ? `${server.tools.length} metadata records` : "No tool metadata"} />
                  <div className="buttonPair">
                    <button
                      className="secondaryButton smallButton"
                      disabled={attachingMcpId === server.id}
                      onClick={() => attachMcpToWorkflow(server)}
                      title={isUnverified ? "Approval required · read-only grant" : undefined}
                    >
                      {attachingMcpId === server.id ? "Adding..." : isUnverified ? "Add (approval required)" : "Add Tool"}
                    </button>
                    <button className="secondaryButton smallButton localPreviewButton" onClick={() => setMcpMessage(`${server.displayName}: ${server.description} Source: ${server.registrySource}. Execution is off.`)}>Details</button>
                  </div>
                </article>
              );
            }) : mcpTools.map((tool) => (
              <article className="mcpCard compactAgentCard" key={tool.name}>
                <div className="panelHeader">
                  <span>{tool.verified}</span>
                  <strong>{tool.risk} risk</strong>
                </div>
                <h3>{tool.name}</h3>
                <p>{tool.scopes}</p>
                <Metric label="Access" value={tool.permission} />
                <Metric label="Works with" value={tool.workflows} />
                <div className="buttonPair">
                  <ComingSoonButton>Add Tool</ComingSoonButton>
                  <button className="secondaryButton smallButton localPreviewButton" onClick={() => setMcpMessage(`${tool.name}: mock metadata preview. Sign in to sync DB-backed details.`)}>Preview details</button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "Templates" && (
        <div className="templateGrid">
          {workflowTemplates.map((workflow) => (
            <WorkflowTemplateCard workflow={workflow} key={workflow.name} />
          ))}
        </div>
      )}
    </section>
  );
}
