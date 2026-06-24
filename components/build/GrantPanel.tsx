"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import {
  attachToolToFlow,
  listConnections,
  listDiscoveredTools,
  removeToolGrant,
  type DiscoveredTool,
  type PersistedConnection
} from "../../lib/api/client";
import type { PersistedWorkflow } from "../../lib/types";
import { Badge, Button } from "../layout/primitives";
import { useToast } from "../layout/Toast";

type Props = {
  workflowId: string;
  workflowName: string;
  existingGrants: { mcpServerId: string; id: string }[];
};

export function GrantPanel({ workflowId, workflowName, existingGrants }: Props) {
  const { data: session } = useSession();
  const toast = useToast();

  const [connections, setConnections] = useState<PersistedConnection[]>([]);
  const [allTools, setAllTools] = useState<(DiscoveredTool & { connectionId: string })[]>([]);
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  const load = async () => {
    if (!session?.user) return;
    try {
      const connData = await listConnections();
      const conns = connData.connections?.filter(
        (c) => c.status === "discovered"
      ) ?? [];
      setConnections(conns);

      // Load tools for each discovered connection.
      const all: (DiscoveredTool & { connectionId: string })[] = [];
      for (const conn of conns) {
        try {
          const toolData = await listDiscoveredTools(conn.id);
          for (const tool of toolData.tools ?? []) {
            all.push({ ...tool, connectionId: conn.id });
          }
        } catch {
          // Skip failed loads.
        }
      }
      setAllTools(all);

      // Mark which are already granted.
      const granted = new Set(
        existingGrants.map((g) => g.mcpServerId)
      );
      setGrantedIds(granted);
    } catch {
      // Silent fallback.
    }
  };

  useEffect(() => {
    load();
  }, [session?.user?.email, workflowId]);

  const handleGrant = async (tool: DiscoveredTool & { connectionId: string }, permission: string) => {
    setLoading(tool.serverRowId);
    try {
      await attachToolToFlow(workflowId, {
        mcpServerId: tool.serverRowId,
        purpose: `${tool.displayName} scoped to ${workflowName}`,
        defaultPermission: permission as "read_only" | "draft_only" | "approval_required" | "blocked"
      }, "Unable to grant tool.");
      setGrantedIds((prev) => new Set(prev).add(tool.serverRowId));
      toast(`${tool.toolName} granted with ${permission.replaceAll("_", " ")} access.`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Grant failed.", "danger");
    } finally {
      setLoading(null);
    }
  };

  const handleRevoke = async (tool: DiscoveredTool & { connectionId: string }) => {
    setLoading(tool.serverRowId);
    try {
      await removeToolGrant(workflowId, tool.serverRowId);
      setGrantedIds((prev) => {
        const next = new Set(prev);
        next.delete(tool.serverRowId);
        return next;
      });
      toast(`${tool.toolName} revoked. Save the flow to reconcile.`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Revoke failed.", "danger");
    } finally {
      setLoading(null);
    }
  };

  if (!session?.user) {
    return <p className="inspectorNote">Sign in to grant discovered tools into this flow.</p>;
  }

  if (connections.length === 0) {
    return (
      <div>
        <p className="inspectorNote">No connected servers with discovered tools.</p>
        <p className="inspectorNote">Go to <strong>Connect</strong> to add a server and discover its tools.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <p className="inspectorNote">
        Grant discovered tools into <strong>{workflowName}</strong>. Ungranted tools are blocked by default.
      </p>

      {allTools.length === 0 && (
        <p className="inspectorNote">No discovered tools available. Connect and discover tools first.</p>
      )}

      {allTools.map((tool) => {
        const isGranted = grantedIds.has(tool.serverRowId);
        return (
          <div
            key={tool.serverRowId}
            style={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
              <strong style={{ fontSize: "0.85rem" }}>{tool.toolName}</strong>
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <Badge risk={tool.isExternalSend ? "high" : "low"} />
                {isGranted && (
                  <span style={{ fontSize: "0.65rem", color: "var(--ok)", fontWeight: 600 }}>
                    GRANTED
                  </span>
                )}
              </div>
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: 0 }}>
              {tool.description ?? "No description"}
            </p>

            {!isGranted ? (
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loading === tool.serverRowId}
                  onClick={() => handleGrant(tool, "read_only")}
                >
                  Allow read
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loading === tool.serverRowId}
                  onClick={() => handleGrant(tool, "draft_only")}
                >
                  Allow draft
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loading === tool.serverRowId}
                  onClick={() => handleGrant(tool, "approval_required")}
                >
                  Require approval
                </Button>
              </div>
            ) : (
              <Button
                variant="danger"
                size="sm"
                loading={loading === tool.serverRowId}
                onClick={() => handleRevoke(tool)}
              >
                Revoke grant
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Hook for use in the Builder inspector.
export function useGrantPanel(workflowId: string, existingGrants: { mcpServerId: string; id: string }[] = []) {
  if (!workflowId) return null;
  return (
    <GrantPanel
      workflowId={workflowId}
      workflowName="this flow"
      existingGrants={existingGrants}
    />
  );
}
