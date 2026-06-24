"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import {
  connectServer,
  disconnectServer,
  discoverTools,
  listConnections,
  listDiscoveredTools,
  listToolServers,
  type DiscoveredTool,
  type PersistedConnection
} from "../../lib/api/client";
import type { PersistedMcpServer } from "../../lib/types";
import { Badge, Button, EmptyState } from "../layout/primitives";
import { useToast } from "../layout/Toast";
import "./connect.css";

type ConnectStep = "connect" | "discover" | "done";

export function ConnectPanel() {
  const { data: session } = useSession();
  const toast = useToast();

  const [connections, setConnections] = useState<PersistedConnection[]>([]);
  const [connectable, setConnectable] = useState<PersistedMcpServer[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [step, setStep] = useState<ConnectStep>("connect");

  const load = async () => {
    if (!session?.user) return;
    try {
      const [connData, serverData] = await Promise.all([
        listConnections(),
        listToolServers()
      ]);
      setConnections(connData.connections ?? []);
      // Connectable servers: catalog entries with mcpServerKey set.
      setConnectable(
        (serverData.servers ?? []).filter((s) =>
          s.name && ["gmail"].includes(s.name)
        )
      );
    } catch {
      // Silently fall back — the UI shows empty states.
    }
  };

  useEffect(() => {
    load();
  }, [session?.user?.email]);

  const loadTools = async (connId: string) => {
    try {
      const data = await listDiscoveredTools(connId);
      setTools(data.tools ?? []);
    } catch {
      setTools([]);
    }
  };

  const handleConnect = async (serverKey: string) => {
    if (!session?.user) return toast("Sign in to connect servers.", "warn");
    setConnectingKey(serverKey);
    try {
      const result = await connectServer(serverKey);
      toast(result.message ?? `Connected to ${serverKey}.`, "ok");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Connection failed.", "danger");
    } finally {
      setConnectingKey(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    setLoading(true);
    try {
      await disconnectServer(id);
      toast("Disconnected.", "ok");
      if (selectedConnId === id) {
        setSelectedConnId(null);
        setTools([]);
        setStep("connect");
      }
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Disconnect failed.", "danger");
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (connId: string) => {
    setDiscovering(true);
    try {
      const result = await discoverTools(connId);
      const count = result.tools?.length ?? 0;
      toast(
        count
          ? `${count} tool${count === 1 ? "" : "s"} discovered.`
          : "No tools discovered.",
        count ? "ok" : "warn"
      );
      await load();
      await loadTools(connId);
      setStep("done");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Discovery failed.", "danger");
    } finally {
      setDiscovering(false);
    }
  };

  const selectConnection = async (conn: PersistedConnection) => {
    setSelectedConnId(conn.id);
    setStep(conn.status === "discovered" ? "done" : "connect");
    if (conn.status === "discovered") {
      await loadTools(conn.id);
    } else {
      setTools([]);
    }
  };

  const selectedConn = connections.find((c) => c.id === selectedConnId);

  if (!session?.user) {
    return (
      <div className="connectRoot">
        <div className="connectPanel">
          <EmptyState
            icon={<span style={{ fontSize: 28 }}>🔌</span>}
            title="Sign in to connect MCP servers"
            body="Connect tools like Gmail, then grant them into your flows."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="connectRoot">
      {/* LEFT: Connect */}
      <div className="connectPanel">
        <div className="connectPanelHead">
          <h2>Connect a server</h2>
          <span className="connectSteps">
            <span className="connectStep" data-active={step === "connect"} data-done={step !== "connect"}>
              <span className="connectStepNum">1</span> Connect
            </span>
            <span className="connectStep" data-active={step === "discover"} data-done={step === "done"}>
              <span className="connectStepNum">2</span> Discover
            </span>
          </span>
        </div>

        <div className="connectPanelBody">
          {connectable.length === 0 && (
            <div className="connectEmpty">
              <span>📡</span>
              <span>No connectable servers found. Sync the catalog first.</span>
            </div>
          )}

          {connectable.map((server) => {
            const conn = connections.find((c) => c.serverKey === server.name);
            const isConnected = conn && (conn.status === "connected" || conn.status === "discovered");
            const isError = conn?.status === "error";

            return (
              <div
                className={`connectionCard ${selectedConnId === conn?.id ? "connectionCardSelected" : ""}`}
                key={server.id}
                onClick={() => conn && selectConnection(conn)}
                style={conn ? { cursor: "pointer" } : undefined}
              >
                <div className="connectionCardTop">
                  <strong>{server.displayName}</strong>
                  {conn ? (
                    <span className="statusBadge" data-status={conn.status}>
                      {conn.status}
                    </span>
                  ) : (
                    <span className="statusBadge" data-status="registered">Not connected</span>
                  )}
                </div>

                {isError && conn?.lastError && (
                  <div className="connectionCardError">{conn.lastError}</div>
                )}

                {!conn || conn.status === "disconnected" ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={connectingKey === server.name}
                    onClick={(e) => { e.stopPropagation(); handleConnect(server.name); }}
                  >
                    Connect
                  </Button>
                ) : isConnected ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {conn?.status === "connected" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={discovering && selectedConnId === conn.id}
                        onClick={(e) => { e.stopPropagation(); selectConnection(conn); handleDiscover(conn.id); }}
                      >
                        Discover tools
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : conn?.status === "error" ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleConnect(server.name); }}
                    >
                      Retry
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleDisconnect(conn.id); }}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Discovered tools */}
      <div className="connectPanel">
        <div className="connectPanelHead">
          <h2>Discovered tools</h2>
          {selectedConn && selectedConn.status === "discovered" && (
            <Button
              variant="ghost"
              size="sm"
              loading={discovering}
              onClick={() => handleDiscover(selectedConn.id)}
            >
              Re-discover
            </Button>
          )}
        </div>

        <div className="connectPanelBody">
          {!selectedConn && (
            <div className="connectEmpty">
              <span>🔍</span>
              <span>Select a connected server to see its tools.</span>
            </div>
          )}

          {selectedConn && selectedConn.status !== "discovered" && tools.length === 0 && (
            <div className="connectEmpty">
              <span>📋</span>
              <span>Discover tools to see what this server exposes.</span>
              <Button
                variant="primary"
                size="sm"
                loading={discovering}
                onClick={() => handleDiscover(selectedConn.id)}
              >
                Discover tools
              </Button>
            </div>
          )}

          {tools.length > 0 && (
            <>
              {selectedConn?.lastDiscoveredAt && (
                <div className="connectionCardMeta">
                  Last discovered: {new Date(selectedConn.lastDiscoveredAt).toLocaleString()}
                </div>
              )}
              {tools.map((tool) => (
                <div className="toolCard" key={tool.serverRowId}>
                  <div className="toolCardTop">
                    <strong>{tool.toolName}</strong>
                    <Badge risk={tool.isExternalSend ? "high" : "low"} />
                  </div>
                  {tool.description && (
                    <div className="toolCardDesc">{tool.description}</div>
                  )}
                  {tool.inputSchema && (
                    <div className="toolCardSchema">
                      {JSON.stringify(tool.inputSchema, null, 2).slice(0, 300)}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
