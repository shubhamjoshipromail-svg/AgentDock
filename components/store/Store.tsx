"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { attachToolToFlow, listFlows, listToolServers, syncToolCatalog } from "../../lib/api/client";
import type { SyncSummary } from "../../lib/api/client";
import { agents, mcpTools, workflowTemplates } from "../mock-data";
import type { McpVerificationStatus, PersistedMcpServer, PersistedWorkflow, StoreTab } from "../../lib/types";
import { Badge, Button, CapabilityBadge, ComingSoonButton, Metric, PageHeader, SearchInput, Select } from "../layout/primitives";
import { useToast } from "../layout/Toast";
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
  const toast = useToast();
  const [mcpServers, setMcpServers] = useState<PersistedMcpServer[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [syncingMcp, setSyncingMcp] = useState(false);
  const [attachingMcpId, setAttachingMcpId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [totalServers, setTotalServers] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVerification, setFilterVerification] = useState<McpVerificationStatus | "">("");
  const [filterRisk, setFilterRisk] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMcpServers = async (opts: { append?: boolean; cursor?: string | null; q?: string; verification?: string; riskLevel?: string } = {}) => {
    if (!session?.user) {
      setMcpServers([]);
      return;
    }

    try {
      const params: Record<string, string | number> = { limit: 24 };
      if (opts.q) params.q = opts.q;
      if (opts.cursor) params.cursor = opts.cursor;
      if (opts.verification) params.verification = opts.verification;
      if (opts.riskLevel) params.riskLevel = opts.riskLevel;

      const data = await listToolServers(params, "Unable to load tool catalog.");
      if (opts.append) {
        setMcpServers((prev) => [...prev, ...(data.servers ?? [])]);
      } else {
        setMcpServers(data.servers ?? []);
      }
      setNextCursor(data.nextCursor ?? null);
      setTotalServers(data.total ?? 0);
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to load tool catalog.", "danger");
      if (!opts.append) setMcpServers([]);
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
      loadMcpServers({ q: searchQuery, verification: filterVerification, riskLevel: filterRisk });
      loadSavedWorkflows();
    }
  }, [tab, session?.user?.email]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadMcpServers({ q: value, verification: filterVerification, riskLevel: filterRisk });
    }, 350);
  };

  const handleFilterChange = (verification: McpVerificationStatus | "", risk: string) => {
    setFilterVerification(verification);
    setFilterRisk(risk);
    loadMcpServers({ q: searchQuery, verification, riskLevel: risk });
  };

  const loadMore = () => {
    if (nextCursor) {
      loadMcpServers({ append: true, cursor: nextCursor, q: searchQuery, verification: filterVerification, riskLevel: filterRisk });
    }
  };

  const syncMcpRegistry = async () => {
    if (!session?.user) {
toast("Sign in with Google to sync tool metadata into AgentDock.", "warn");
      return;
    }

    setSyncingMcp(true);

    try {
      const data = await syncToolCatalog("Tool sync failed.");
      setSyncSummary(data);
      setLastSyncedAt(new Date().toLocaleTimeString());
toast(`Synced ${data.upserted} servers · ${data.skipped} skipped · ${data.failed} failed (${data.durationMs}ms)`, "ok");
      await loadMcpServers({ q: searchQuery, verification: filterVerification, riskLevel: filterRisk });
    } catch (error) {
toast(error instanceof Error ? error.message : "Tool sync failed.", "danger");
    } finally {
      setSyncingMcp(false);
    }
  };

  const attachMcpToWorkflow = async (server: PersistedMcpServer) => {
    if (!session?.user) {
toast("Sign in with Google to add tools to a saved Flow.", "warn");
      return;
    }

    if (savedWorkflows.length === 0) {
toast("Save a Flow from Build first, then add tools to it.", "warn");
      return;
    }

    const workflow = selectedFlowId
      ? savedWorkflows.find((item) => item.id === selectedFlowId)
      : savedWorkflows.length === 1
        ? savedWorkflows[0]
        : undefined;

    if (!workflow?.id) {
toast("Select which Flow to add this tool to.", "warn");
      return;
    }

    const defaultPermission = server.recommendedPermission;
    setAttachingMcpId(server.id);

    try {
      await attachToolToFlow(workflow.id, {
        mcpServerId: server.id,
        purpose: `${server.displayName} scoped to ${workflow.name}`,
        defaultPermission
      }, "Unable to add tool to Flow.");

toast(`${server.displayName} added to ${workflow.name} with ${defaultPermission.replaceAll("_", " ")} access.`, "ok");
      await loadSavedWorkflows();
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to add tool to Flow.", "danger");
    } finally {
      setAttachingMcpId("");
    }
  };

  const dbMcpAvailable = Boolean(session?.user && mcpServers.length);

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Store" title="Store" copy="Install agents and tools like apps. Govern them like infrastructure." />
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
                <Metric label="Mode" value={agent.defaultMode} />
              </div>
            </article>
          ))}
        </div>
      )}
      {tab === "Tools" && (
        <>
          <div className="mcpStoreIntro">
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
                {syncingMcp ? "Syncing..." : "Sync catalog"}
              </button>
              <CapabilityBadge kind={session?.user ? "db" : "mock"} />
            </div>
            {lastSyncedAt && (
              <p className="rankText">Last synced: {lastSyncedAt}{syncSummary ? ` · ${syncSummary.upserted} servers · ${syncSummary.skipped} skipped` : ""}</p>
            )}
          </div>
          {session?.user && (
            <div className="storeToolbar">
              <SearchInput
                placeholder="Search tools…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                aria-label="Search tools"
              />
              <Select
                value={filterVerification}
                onChange={(e) => handleFilterChange(e.target.value as McpVerificationStatus | "", filterRisk)}
                aria-label="Filter by verification"
              >
                <option value="">All verifications</option>
                <option value="verified">Verified</option>
                <option value="community">Community</option>
                <option value="unverified">Unverified</option>
              </Select>
              <Select
                value={filterRisk}
                onChange={(e) => handleFilterChange(filterVerification, e.target.value)}
                aria-label="Filter by risk"
              >
                <option value="">All risk levels</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="restricted">Restricted</option>
              </Select>
              {totalServers > 0 && (
                <span className="rankText storeResultCount">{totalServers} result{totalServers !== 1 ? "s" : ""}</span>
              )}
            </div>
          )}
          <div className="mcpGrid compactStoreGrid">
            {dbMcpAvailable ? mcpServers.map((server) => {
              const defaultPermission = server.recommendedPermission;
              const isUnverified = server.verificationStatus === "unverified";
              return (
                <article className="mcpCard compactAgentCard" key={server.id}>
                  <div className="panelHeader">
                    <span>{server.category ?? "Uncategorized"}</span>
                    <Badge risk={server.riskLevel} />
                  </div>
                  <h3>{server.displayName}</h3>
                  <p>{server.description}</p>
                  <div className="badgeGroup">
                    <Badge verification={server.verificationStatus} />
                  </div>
                  <Metric label="Access" value={defaultPermission.replaceAll("_", " ")} />
                  <Metric label="Tools" value={server.tools?.length ? `${server.tools.length} metadata records` : "No tool metadata"} />
                  {server.repositoryUrl && (
                    <Metric label="Repo" value={server.repositoryUrl.replace("https://github.com/", "github/")} />
                  )}
                  <div className="buttonPair">
                    <button
                      className="secondaryButton smallButton"
                      disabled={attachingMcpId === server.id}
                      onClick={() => attachMcpToWorkflow(server)}
                      title={isUnverified ? "Approval required · read-only grant" : undefined}
                    >
                      {attachingMcpId === server.id ? "Adding..." : isUnverified ? "Add (approval required)" : "Add Tool"}
                    </button>
                    <button className="secondaryButton smallButton" onClick={() => toast(`${server.displayName}: ${server.description}`, "info")}>Details</button>
                  </div>
                </article>
              );
            }) : mcpTools.map((tool) => (
              <article className="mcpCard compactAgentCard" key={tool.name}>
                <div className="panelHeader">
                  <span>{tool.workflows}</span>
                  <span className="rankText">{tool.risk} risk</span>
                </div>
                <h3>{tool.name}</h3>
                <p>{tool.scopes}</p>
                <Metric label="Access" value={tool.permission} />
                <Metric label="Works with" value={tool.workflows} />
                <div className="buttonPair">
                  <ComingSoonButton>Add Tool</ComingSoonButton>
                  <button className="secondaryButton smallButton" onClick={() => toast(`${tool.name}: mock metadata preview. Sign in to sync DB-backed details.`, "info")}>Preview details</button>
                </div>
              </article>
            ))}
          </div>
          {dbMcpAvailable && nextCursor && (
            <div className="storeLoadMore">
              <Button onClick={loadMore}>Load more</Button>
            </div>
          )}
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
