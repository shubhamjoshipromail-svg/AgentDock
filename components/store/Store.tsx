"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { attachToolToFlow, listFlows, listToolServers, syncToolCatalog } from "../../lib/api/client";
import type { SyncSummary } from "../../lib/api/client";
import { agents, mcpTools, workflowTemplates } from "../mock-data";
import type { McpVerificationStatus, PersistedMcpServer, PersistedWorkflow, StoreTab } from "../../lib/types";
import { Avatar, Badge, Button, ComingSoonButton, Data, Logo, Metric, PageHeader, SearchInput, Select, SkeletonGrid } from "../layout/primitives";
import { useToast } from "../layout/Toast";
import { deriveLogoSrc } from "./logo";
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
  const [detailServer, setDetailServer] = useState<PersistedMcpServer | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);

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

    if (!opts.append) setLoadingServers(true);
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
    } finally {
      setLoadingServers(false);
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
              <div className="objCardHead">
                <Avatar name={agent.name} />
                <div className="objCardTitle">
                  <h3>{agent.name}</h3>
                  <span className="rankText">{agent.category}</span>
                </div>
                {agent.verified && <span className="verifiedBadge">Verified</span>}
              </div>
              <p>{agent.description}</p>
              <div className="agentStats compactStats">
                <Metric label="Provider" value={agent.provider} />
                <Metric label="Mode" value={agent.defaultMode} />
              </div>
              <div className="buttonPair objCardFooter">
                <ComingSoonButton>Install</ComingSoonButton>
                <ComingSoonButton>{defaultAgent === agent.name ? "Default" : "Set default"}</ComingSoonButton>
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
              <Button variant="primary" onClick={syncMcpRegistry} loading={syncingMcp}>Sync catalog</Button>
            </div>
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
              {lastSyncedAt && (
                <span className="storeSyncStatus">Synced <Data>{lastSyncedAt}</Data>{syncSummary ? <> · <Data>{syncSummary.upserted}</Data> servers</> : null}</span>
              )}
            </div>
          )}
          {session?.user && loadingServers && !mcpServers.length ? <SkeletonGrid count={6} /> : (
          <div className="mcpGrid compactStoreGrid">
            {dbMcpAvailable ? mcpServers.map((server) => {
              const defaultPermission = server.recommendedPermission;
              const isUnverified = server.verificationStatus === "unverified";
              return (
                <article className="mcpCard compactAgentCard" key={server.id}>
                  <div className="objCardHead">
                    <Logo src={deriveLogoSrc(server)} label={server.displayName} />
                    <div className="objCardTitle">
                      <h3>{server.displayName}</h3>
                      <span className="rankText">{server.category ?? "Uncategorized"}</span>
                    </div>
                    <Badge risk={server.riskLevel} />
                  </div>
                  <p>{server.description}</p>
                  <div className="badgeGroup">
                    <Badge verification={server.verificationStatus} />
                  </div>
                  <div className="buttonPair objCardFooter">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={attachingMcpId === server.id}
                      onClick={() => attachMcpToWorkflow(server)}
                      title={isUnverified ? "Approval required · read-only grant" : undefined}
                    >
                      {attachingMcpId === server.id ? "Adding…" : isUnverified ? "Add (approval required)" : "Add to flow"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDetailServer(server)}>Details</Button>
                  </div>
                </article>
              );
            }) : mcpTools.map((tool) => (
              <article className="mcpCard compactAgentCard" key={tool.name}>
                <div className="objCardHead">
                  <Logo label={tool.name} />
                  <div className="objCardTitle">
                    <h3>{tool.name}</h3>
                    <span className="rankText">{tool.workflows}</span>
                  </div>
                  <span className="rankText">{tool.risk} risk</span>
                </div>
                <p>{tool.scopes}</p>
                <Metric label="Access" value={tool.permission} />
                <div className="buttonPair objCardFooter">
                  <ComingSoonButton>Add to flow</ComingSoonButton>
                  <Button variant="ghost" size="sm" onClick={() => toast(`${tool.name}: mock metadata preview. Sign in to sync DB-backed details.`, "info")}>Details</Button>
                </div>
              </article>
            ))}
          </div>
          )}
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

      {detailServer && (
        <div className="detailOverlay" onClick={() => setDetailServer(null)} role="presentation">
          <aside className="detailPanel" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={`${detailServer.displayName} details`}>
            <div className="detailPanelHead">
              <div className="objCardHead">
                <Logo src={deriveLogoSrc(detailServer)} label={detailServer.displayName} />
                <div className="objCardTitle">
                  <h3>{detailServer.displayName}</h3>
                  <span className="rankText">{detailServer.category ?? "Uncategorized"}</span>
                </div>
              </div>
              <button className="iconToggle" onClick={() => setDetailServer(null)} aria-label="Close details">✕</button>
            </div>
            <p>{detailServer.description}</p>
            <div className="badgeGroup">
              <Badge risk={detailServer.riskLevel} />
              <Badge verification={detailServer.verificationStatus} />
            </div>
            <Metric label="Access" value={detailServer.recommendedPermission.replaceAll("_", " ")} />
            <Metric label="Source" value={detailServer.registrySource} />
            {detailServer.repositoryUrl && (
              <Metric label="Repo" value={detailServer.repositoryUrl.replace("https://github.com/", "github/")} />
            )}
            {detailServer.tools?.length ? (
              <div className="detailTools">
                <span className="buildLibraryLabel">Tools ({detailServer.tools.length})</span>
                {detailServer.tools.slice(0, 10).map((toolItem) => (
                  <div className="inspectorRow" key={toolItem.id}>
                    <div><strong>{toolItem.name}</strong><Badge risk={toolItem.riskLevel} /></div>
                    {toolItem.description && <p>{toolItem.description}</p>}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="buttonPair">
              <Button variant="primary" size="sm" disabled={attachingMcpId === detailServer.id} onClick={() => attachMcpToWorkflow(detailServer)}>Add to flow</Button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
