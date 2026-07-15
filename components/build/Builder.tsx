"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import {
  attachToolToFlow,
  listFlows,
  listToolServers,
  planFlow,
  saveFlow
} from "../../lib/api/client";
import { planToSaveInput } from "../../lib/orchestrator/convert";
import { PERMISSION_VALUES, permissionRank, type PlannedFlow, type PlannedFlowResponse } from "../../lib/orchestrator/schema";
import {
  mcpTools,
  recommendedBuilderNodes,
  stepDisplayNames
} from "../mock-data";
import { serializeBuilderFlow, workflowToBuilderNodes } from "./serialize";
import { GrantPanel } from "./GrantPanel";
import { FlowGraph } from "./FlowGraph";
import { builderNodesToGraph, plannedFlowToGraph } from "./flow-graph";
import type {
  BuilderMode,
  BuilderNode,
  McpDefaultPermission,
  McpRiskLevel,
  McpVerificationStatus,
  PersistedMcpServer,
  PersistedWorkflow
} from "../../lib/types";
import { Badge, Button, DetailBlock, EmptyState } from "../layout/primitives";
import { useToast } from "../layout/Toast";

const EXAMPLE_GOALS = [
  "Find AI platform roles, tailor my resume, and draft outreach for approval.",
  "Research 5 competitors and draft a weekly market digest for approval.",
  "Triage new GitHub issues and draft replies without posting."
];


export function Builder({
  prompt,
  setPrompt,
  nodes,
  selectedNodeId,
  setSelectedNodeId,
  onRecommend,
  onAddNode,
  onRemoveNode,
  onLoadWorkflow,
  onSave,
  onViewLogs,
  activeFlowId
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  nodes: BuilderNode[];
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  saved: boolean;
  onRecommend: () => void;
  onAddNode: (node: BuilderNode) => void;
  onRemoveNode: (id: string) => void;
  onLoadWorkflow: (nodes: BuilderNode[]) => void;
  onSave: () => void;
  onViewLogs: () => void;
  onSetDefault: (agent: string) => void;
  // When the canvas is embedded as the workspace's "Build canvas" drawer, this is
  // the flow currently being watched — the canvas loads THAT flow so the thing you
  // edit is the thing you run.
  activeFlowId?: string | null;
}) {
  const { data: session } = useSession();
  const toast = useToast();
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];

  const [builderMode, setBuilderMode] = useState<BuilderMode>("empty");
  const [savedWorkflowId, setSavedWorkflowId] = useState("");
  const [savedWorkflows, setSavedWorkflows] = useState<PersistedWorkflow[]>([]);
  const [mcpServers, setMcpServers] = useState<PersistedMcpServer[]>([]);
  const [attachingMcpId, setAttachingMcpId] = useState("");

  // Orchestrator (real model planning) state.
  const [planning, setPlanning] = useState(false);
  const [planned, setPlanned] = useState<PlannedFlowResponse | null>(null);
  const [planElapsed, setPlanElapsed] = useState(0);
  const [planError, setPlanError] = useState("");
  const [planRevealKey, setPlanRevealKey] = useState(0);
  const [permissionEdits, setPermissionEdits] = useState<Record<string, (typeof PERMISSION_VALUES)[number]>>({});
  const [budgetEdit, setBudgetEdit] = useState<number | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  // UI state: inspector tab + library collapse.
  const [inspectorTab, setInspectorTab] = useState<"plan" | "participant">("plan");
  const [libraryOpen, setLibraryOpen] = useState(true);

  const hasDraftWorkflow = builderMode !== "empty";
  const hasPlan = Boolean(planned) && !planning;
  const currentWorkflow = (savedWorkflowId ? savedWorkflows.find((w) => w.id === savedWorkflowId) : undefined) ?? savedWorkflows[0];

  const loadSavedWorkflows = async () => {
    if (!session?.user) return setSavedWorkflows([]);
    try {
      const data = await listFlows("Unable to load saved Flows.");
      setSavedWorkflows(data.workflows ?? []);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to load saved Flows.", "danger");
    }
  };

  const loadMcpServers = async () => {
    if (!session?.user) return setMcpServers([]);
    try {
      const data = await listToolServers();
      setMcpServers(data.servers ?? []);
    } catch {
      setMcpServers([]);
    }
  };

  useEffect(() => {
    loadSavedWorkflows();
    loadMcpServers();
  }, [session?.user?.email]);

  // Sync the canvas to the flow being watched in the workspace, so editing the
  // graph edits the same flow you run — no separate flow selection in the drawer.
  useEffect(() => {
    if (!activeFlowId || !session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await listFlows("Unable to load saved Flows.");
        const fresh = (data.workflows ?? []).find((w) => w.id === activeFlowId);
        if (!fresh || cancelled) return;
        setSavedWorkflows(data.workflows ?? []);
        setSavedWorkflowId(fresh.id);
        setBuilderMode("saved");
        onLoadWorkflow(workflowToBuilderNodes(fresh));
      } catch { /* mute — the workspace surfaces flow errors */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFlowId, session?.user?.email]);

  // Honest elapsed timer while a plan request is in flight (no fake step labels).
  useEffect(() => {
    if (!planning) return setPlanElapsed(0);
    const started = Date.now();
    const id = window.setInterval(() => setPlanElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [planning]);

  const generateWorkflowDraft = () => {
    onRecommend();
    setBuilderMode("draft");
    setSavedWorkflowId("");
    setPlanned(null);
    setInspectorTab("participant");
    toast("Template loaded as a draft. Save to Flows to run.", "info");
  };

  const generatePlan = async () => {
    if (!prompt.trim()) return toast("Describe the outcome first.", "warn");
    if (!session?.user) return toast("Sign in with Google to plan a flow with a model.", "warn");

    setPlanning(true);
    setPlanned(null);
    setPlanError("");
    setPermissionEdits({});
    setBudgetEdit(null);
    setInspectorTab("plan");

    try {
      // TODO(streaming): a future backend chunk will replace this single awaited
      // call with SSE token-streaming so nodes reveal in true real time as the
      // model emits them. Until then the wait is honest (elapsed + indeterminate)
      // and the staged reveal below renders the completed result.
      const data = await planFlow(prompt);
      setPlanned(data);
      setBudgetEdit(data.plan.estimatedBudgetCents);
      setPlanRevealKey((key) => key + 1);
      toast(
        data.warnings.length
          ? `${data.warnings.length} item(s) adjusted by policy. Review and save.`
          : "Plan ready. Review and save.",
        data.warnings.length ? "warn" : "ok"
      );
    } catch (error) {
      setPlanned(null);
      const message = error instanceof Error ? error.message : "Unable to plan this flow.";
      setPlanError(message);
      toast(message, "danger");
    } finally {
      setPlanning(false);
    }
  };

  const buildEditedPlan = (): PlannedFlow | null => {
    if (!planned) return null;
    return {
      ...planned.plan,
      estimatedBudgetCents: budgetEdit ?? planned.plan.estimatedBudgetCents,
      tools: planned.plan.tools.map((tool) => ({
        ...tool,
        effectivePermission: permissionEdits[tool.mcpServerId] ?? tool.effectivePermission
      }))
    };
  };

  const savePlannedFlow = async () => {
    const plan = buildEditedPlan();
    if (!plan) return;
    if (!session?.user) return toast("Sign in to save this flow.", "warn");

    setSavingPlan(true);
    try {
      const data = await saveFlow(planToSaveInput(plan), "Flow save failed.");
      onSave();
      setBuilderMode("saved");
      setSavedWorkflowId(data.workflow?.id ?? "");
      // Reconcile the canvas to exactly what persisted (flow truth).
      if (data.workflow) onLoadWorkflow(workflowToBuilderNodes(data.workflow));
      toast("Planned flow saved to Flows.", "ok");
      await loadSavedWorkflows();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Flow save failed.", "danger");
    } finally {
      setSavingPlan(false);
    }
  };

  const saveDraftFlow = async () => {
    if (!session?.user) return toast("Sign in to save this flow to Flows.", "warn");
    if (!hasDraftWorkflow) return toast("Plan or load a flow before saving.", "warn");

    setSavingWorkflow(true);
    try {
      const data = await saveFlow(serializeBuilderFlow(prompt, nodes), "Flow save failed.");
      onSave();
      setBuilderMode("saved");
      setSavedWorkflowId(data.workflow?.id ?? "");
      // Reconcile the canvas to exactly what persisted (flow truth).
      if (data.workflow) onLoadWorkflow(workflowToBuilderNodes(data.workflow));
      toast("Flow saved to Flows.", "ok");
      await loadSavedWorkflows();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Flow save failed.", "danger");
    } finally {
      setSavingWorkflow(false);
    }
  };

  // Reopen the saved flow onto the canvas from PERSISTED state (agents, tools,
  // grants, scoped memory) — never the layout blob. Proves "what runs is what's
  // stored": a removed tool is gone, not lingering. (Chunk 8 flow truth.)
  const reloadFromSaved = async () => {
    if (!session?.user) return toast("Sign in to open a saved flow.", "warn");
    try {
      const data = await listFlows("Unable to load saved Flows.");
      const fresh = (data.workflows ?? []).find((w) => w.id === (savedWorkflowId || currentWorkflow?.id));
      if (!fresh) return toast("Save this flow first to reopen it.", "warn");
      setSavedWorkflows(data.workflows ?? []);
      setSavedWorkflowId(fresh.id);
      setBuilderMode("saved");
      onLoadWorkflow(workflowToBuilderNodes(fresh));
      toast(`Reopened ${fresh.name} from saved state.`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to load saved Flows.", "danger");
    }
  };

  const addMcpVisualNode = (server: { name: string; displayName: string; category?: string | null; riskLevel: McpRiskLevel; recommendedPermission: McpDefaultPermission; tools?: unknown[] }) => {
    onAddNode({
      id: `mcp-${server.name}`,
      name: server.displayName,
      type: "mcp",
      category: server.category ?? "Tool",
      riskLevel: server.riskLevel,
      permissions: `${server.recommendedPermission.replaceAll("_", " ")} permission template`,
      memoryAccess: "No memory access by default",
      budgetImpact: "$0.00 metadata only",
      approvalMode: server.riskLevel === "low" ? "Allowed inside flow scope" : "Approval gated",
      attachments: [`${server.tools?.length ?? 0} tool metadata records`, "No execution in Phase 1"]
    });
    if (!hasDraftWorkflow) setBuilderMode("draft");
  };

  const attachBuilderMcp = async (server: PersistedMcpServer) => {
    if (!session?.user) return toast("Sign in to add tools to a saved flow.", "warn");
    const target = savedWorkflowId ? savedWorkflows.find((w) => w.id === savedWorkflowId) : currentWorkflow;
    if (!target?.id) return toast("Save this flow first to add tools.", "warn");

    setAttachingMcpId(server.id);
    try {
      await attachToolToFlow(target.id, {
        mcpServerId: server.id,
        purpose: `${server.displayName} scoped to ${target.name}`,
        defaultPermission: server.recommendedPermission
      }, "Unable to add tool to flow.");
      addMcpVisualNode(server);
      toast(`${server.displayName} added with ${server.recommendedPermission.replaceAll("_", " ")} access.`, "ok");
      await loadSavedWorkflows();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to add tool to flow.", "danger");
    } finally {
      setAttachingMcpId("");
    }
  };

  const paletteServers = mcpServers.length
    ? mcpServers
    : mcpTools.map((tool) => ({
        id: tool.name,
        name: tool.name.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-"),
        displayName: tool.name,
        description: tool.scopes,
        registrySource: "mock",
        verificationStatus: (tool.verified === "Verified" ? "verified" : "unverified") as McpVerificationStatus,
        riskLevel: tool.risk.toLowerCase() as McpRiskLevel,
        recommendedPermission: (tool.permission.toLowerCase().replaceAll(" ", "_") || "approval_required") as McpDefaultPermission,
        category: tool.workflows,
        tools: []
      }));

  const stepDetails = selectedNode
    ? {
        purpose: stepDisplayNames[selectedNode.name] ?? selectedNode.approvalMode ?? "Flow component.",
        type: selectedNode.type === "control" ? "approval" : selectedNode.type === "mcp" ? "tool" : selectedNode.type,
        risk: selectedNode.riskLevel ?? "low",
        memory: selectedNode.memoryAccess,
        cost: selectedNode.budgetImpact,
        approvals: selectedNode.approvalMode
      }
    : null;

  return (
    <div className="buildWorkspace">
      <aside className={libraryOpen ? "buildLibrary" : "buildLibrary collapsed"}>
        <div className="buildLibraryHead">
          {libraryOpen && <span>Library</span>}
          <button className="iconToggle" onClick={() => setLibraryOpen((v) => !v)} aria-label={libraryOpen ? "Collapse library" : "Expand library"}>
            {libraryOpen ? "‹" : "›"}
          </button>
        </div>
        {libraryOpen && (
          <div className="buildLibraryBody">
            <div className="buildLibrarySection">
              <span className="buildLibraryLabel">Templates</span>
              <Button variant="secondary" size="sm" onClick={generateWorkflowDraft}>Load starter template</Button>
            </div>
            <div className="buildLibrarySection">
              <span className="buildLibraryLabel">Tools</span>
              <p className="buildLibraryHint">Add tool metadata to the canvas. Execution stays off.</p>
              <div className="paletteList">
                {paletteServers.slice(0, 8).map((server) => (
                  <div className="paletteCard" key={server.id}>
                    <div className="paletteCardTop">
                      <strong>{server.displayName}</strong>
                      <Badge risk={server.riskLevel} />
                    </div>
                    <div className="paletteCardActions">
                      <Button variant="ghost" size="sm" onClick={() => addMcpVisualNode(server)}>Add to canvas</Button>
                      <Button variant="secondary" size="sm" disabled={attachingMcpId === server.id || !mcpServers.length} onClick={() => attachBuilderMcp(server as PersistedMcpServer)}>
                        {attachingMcpId === server.id ? "Adding…" : "Add tool"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </aside>

      <section className="buildCanvasZone">
        <div className="commandBar">
          <textarea
            className="commandInput"
            aria-label="Flow goal"
            placeholder="Describe an outcome — e.g. find AI roles, tailor my resume, and draft outreach for approval."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
          />
          <div className="commandActions">
            <Button variant="primary" onClick={generatePlan} loading={planning}>Plan flow</Button>
          </div>
        </div>
        {hasPlan && planned && (
          <p className="planMetaLine data">
            {planned.planMeta.provider} · {planned.planMeta.model} · {planned.planMeta.inputTokens + planned.planMeta.outputTokens} tokens · {planned.planMeta.costCents}¢ · {planned.planMeta.durationMs}ms
          </p>
        )}

        {hasPlan && planned && planned.warnings.length > 0 && (
          <div className="warningsStrip">
            <div className="warningsStripHead">
              <span>{planned.warnings.length} permission{planned.warnings.length === 1 ? "" : "s"} adjusted by policy</span>
            </div>
            <div className="warningsStripList">
              {planned.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          </div>
        )}

        <div className="buildCanvas">
          {planning ? (
            <div className="canvasProgress" aria-live="polite" aria-busy="true">
              <div className="planningGoalNode">
                <span className="flowNodeGlyph" aria-hidden>◎</span>
                <div className="planningGoalBody">
                  <strong>Goal</strong>
                  <span>{prompt.length > 90 ? `${prompt.slice(0, 88)}…` : prompt}</span>
                </div>
              </div>
              <div className="canvasProgressBar"><span /></div>
              <span className="canvasPlanningLine">Planning your flow…</span>
              <span className="canvasPlanningHint">
                Complex goals can take ~30–60s · <span className="data">{planElapsed}s</span>
              </span>
            </div>
          ) : planError ? (
            <div className="canvasEmpty">
              <EmptyState
                icon={<span style={{ fontSize: 28 }}>⚠</span>}
                title="Planning didn’t complete"
                body={planError}
                action={<Button variant="primary" onClick={generatePlan}>Try again</Button>}
              />
            </div>
          ) : hasPlan && planned ? (
            <FlowGraph key={planRevealKey} input={plannedFlowToGraph(planned.plan)} animate />
          ) : hasDraftWorkflow ? (
            <FlowGraph input={builderNodesToGraph(prompt, nodes)} selectedId={selectedNode?.id} onSelect={(id) => { setSelectedNodeId(id); setInspectorTab("participant"); }} />
          ) : (
            <div className="canvasEmpty">
              <EmptyState
                icon={<span style={{ fontSize: 28 }}>◎</span>}
                title="Describe an outcome and AgentDock assembles the flow"
                body="The plan draws itself onto this canvas — agents, tools, memory, and approval gates."
              />
              <div className="exampleChips">
                {EXAMPLE_GOALS.map((goal) => (
                  <button className="exampleChip" key={goal} onClick={() => setPrompt(goal)}>{goal}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="buildInspector">
        <div className="inspectorTabs" role="tablist">
          <button role="tab" aria-selected={inspectorTab === "plan"} className={inspectorTab === "plan" ? "inspectorTab active" : "inspectorTab"} onClick={() => setInspectorTab("plan")}>Plan</button>
          <button role="tab" aria-selected={inspectorTab === "participant"} className={inspectorTab === "participant" ? "inspectorTab active" : "inspectorTab"} onClick={() => setInspectorTab("participant")}>Participant</button>
        </div>

        <div className="inspectorBody">
          {inspectorTab === "plan" ? (
            hasPlan && planned ? (
              <>
                <div className="inspectorBlock">
                  <h3>{planned.plan.name}</h3>
                  <div className="planGroupLabel">Agents</div>
                  {planned.plan.agents.map((agent) => (
                    <div className="inspectorRow" key={`${agent.agentName}-${agent.order}`}>
                      <div><strong>{agent.agentName}</strong><span>{agent.role}</span></div>
                      <p>{agent.rationale}</p>
                    </div>
                  ))}
                </div>

                {planned.plan.tools.length > 0 && (
                  <div className="inspectorBlock">
                    <div className="planGroupLabel">Tools</div>
                    {planned.plan.tools.map((tool) => {
                      const current = permissionEdits[tool.mcpServerId] ?? tool.effectivePermission;
                      const options = PERMISSION_VALUES.filter((value) => permissionRank(value) >= permissionRank(tool.ceiling));
                      return (
                        <div className="inspectorRow" key={tool.mcpServerId}>
                          <div className="inspectorRowTop"><strong>{tool.displayName}</strong><Badge risk={tool.riskLevel} /></div>
                          <p>{tool.rationale}</p>
                          <label className="planPermissionLabel">
                            Permission (ceiling: {tool.ceiling.replaceAll("_", " ")})
                            <select value={current} onChange={(event) => setPermissionEdits((prev) => ({ ...prev, [tool.mcpServerId]: event.target.value as (typeof PERMISSION_VALUES)[number] }))}>
                              {options.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
                            </select>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}

                {planned.plan.memoryAttachments.length > 0 && (
                  <div className="inspectorBlock">
                    <div className="planGroupLabel">Memory</div>
                    {planned.plan.memoryAttachments.map((attachment) => (
                      <div className="inspectorRow" key={attachment.partitionName}>
                        <div><strong>{attachment.partitionName}</strong><span>{attachment.access.replaceAll("_", " ")}</span></div>
                        <p>{attachment.rationale}</p>
                      </div>
                    ))}
                  </div>
                )}

                {planned.plan.approvalGates.length > 0 && (
                  <div className="inspectorBlock">
                    <div className="planGroupLabel">Approval gates</div>
                    {planned.plan.approvalGates.map((gate, index) => (
                      <div className="inspectorRow" key={`gate-${index}`}>
                        <div><strong>After agent {gate.afterAgentOrder}</strong><span>{gate.actionType}</span></div>
                        <p>{gate.trigger}</p>
                      </div>
                    ))}
                    <p className="inspectorNote">Pending approvals are decided in Control.</p>
                  </div>
                )}

                <div className="inspectorBlock">
                  <div className="planGroupLabel">Budget</div>
                  <label className="planPermissionLabel">
                    Weekly cap (cents)
                    <input type="number" min={0} value={budgetEdit ?? 0} onChange={(event) => setBudgetEdit(Math.max(0, Number(event.target.value) || 0))} />
                  </label>
                </div>

                {planned.plan.risks.length > 0 && (
                  <div className="inspectorBlock">
                    <div className="planGroupLabel">Risks</div>
                    {planned.plan.risks.map((risk, index) => (
                      <div className="inspectorRow" key={`risk-${index}`}>
                        <div className="inspectorRowTop"><strong>{risk.level} risk</strong><Badge risk={risk.level as McpRiskLevel} /></div>
                        <p>{risk.description}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="inspectorActions">
                  <Button variant="primary" onClick={savePlannedFlow} loading={savingPlan}>Save flow</Button>
                </div>
              </>
            ) : hasDraftWorkflow ? (
              <div className="inspectorBlock">
                <h3>{currentWorkflow?.name ?? "Draft flow"}</h3>
                <p className="inspectorNote">A template draft is on the canvas. Save it to Flows to run, or describe an outcome and plan a new one.</p>
                <div className="inspectorActions">
                  <Button variant="primary" onClick={saveDraftFlow} loading={savingWorkflow}>Save flow</Button>
                  {builderMode === "saved" && <Button variant="ghost" onClick={reloadFromSaved}>Reopen from saved</Button>}
                </div>
              </div>
            ) : (
              <EmptyState title="No plan yet" body="Describe an outcome and press Plan flow. The plan appears here and on the canvas." />
            )
          ) : selectedNode && stepDetails ? (
            <>
              <div className="inspectorBlock">
                <h3>{stepDisplayNames[selectedNode.name] ?? selectedNode.name}</h3>
                <p>{stepDetails.purpose}</p>
                <div className="inspectorGrid">
                  <DetailBlock label="Type" value={stepDetails.type} />
                  <DetailBlock label="Risk" value={stepDetails.risk} />
                  <DetailBlock label="Memory" value={stepDetails.memory} />
                  <DetailBlock label="Cost" value={stepDetails.cost} />
                  <DetailBlock label="Approvals" value={stepDetails.approvals} />
                </div>
                {selectedNode.type !== "goal" && (
                  <div className="inspectorActions">
                    <Button variant="danger" size="sm" onClick={() => onRemoveNode(selectedNode.id)}>Remove from canvas</Button>
                    <Button variant="ghost" size="sm" onClick={onViewLogs}>View timeline</Button>
                  </div>
                )}
              </div>
              <div className="inspectorBlock">
                <h3>Tool grants</h3>
                {savedWorkflowId || currentWorkflow?.id ? (
                  <GrantPanel
                    workflowId={savedWorkflowId || currentWorkflow?.id || ""}
                    workflowName={currentWorkflow?.name ?? "Draft flow"}
                    existingGrants={
                      currentWorkflow?.mcpAccessGrants?.map((g) => ({
                        mcpServerId: g.mcpServer.id,
                        id: g.id
                      })) ?? []
                    }
                  />
                ) : (
                  <p className="inspectorNote">Save the flow before granting tools. Ungranted tools remain blocked.</p>
                )}
              </div>
            </>
          ) : (
            <EmptyState title="Select a step" body="Click a node on the canvas to inspect its access, memory, cost, and approvals." />
          )}
        </div>
      </aside>
    </div>
  );
}
