"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { loadMemory } from "../../lib/api/client";
import type { BuilderNode, PersistedMemoryPartition } from "../../lib/types";

export function MemoryFirewallVisualizer({ selectedNode }: { selectedNode?: BuilderNode }) {
  const { data: session } = useSession();
  const [dbPartitions, setDbPartitions] = useState<PersistedMemoryPartition[]>([]);
  const accessByNode: Record<string, string[]> = {
    "Job Discovery Agent": ["Global Profile", "Job Search Memory"],
    "Company Research Agent": ["Job Search Memory", "Research Memory"],
    "Resume Tailoring Agent": ["Job Search Memory", "Resume Memory"],
    "Outreach Draft Agent": ["Job Search Memory"],
    "A2UI Approval Gate": ["Global Profile", "Job Search Memory", "Resume Memory", "Research Memory"]
  };

  useEffect(() => {
    if (!session?.user) {
      setDbPartitions([]);
      return;
    }

    const loadMemoryPolicy = async () => {
      try {
        const data = await loadMemory();
        setDbPartitions(data.partitions ?? []);
      } catch {
        setDbPartitions([]);
      }
    };

    loadMemoryPolicy();
  }, [session?.user?.email]);

  const allowedForSelected = accessByNode[selectedNode?.name ?? ""] ?? [];
  const zones = dbPartitions.length
    ? dbPartitions.map((partition) => {
        const matchingGrant = partition.accessGrants.find((grant) => grant.agent?.name === selectedNode?.name);
        const canAccess = Boolean(matchingGrant && (matchingGrant.canRead || matchingGrant.canWrite || matchingGrant.canEdit || matchingGrant.canShare));
        return {
          name: partition.name,
          status: canAccess ? "allowed" : partition.defaultAccessPolicy === "blocked_by_default" ? "blocked" : partition.defaultAccessPolicy.replaceAll("_", " "),
          selectedAccess: canAccess
        };
      })
    : [
        { name: "Global Profile", status: "limited", selectedAccess: false },
        { name: "Job Search Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Job Search Memory") },
        { name: "Resume Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Resume Memory") },
        { name: "Research Memory", status: "allowed", selectedAccess: allowedForSelected.includes("Research Memory") },
        { name: "Finance Memory", status: "blocked", selectedAccess: false },
        { name: "Health Memory", status: "blocked", selectedAccess: false },
        { name: "Travel Memory", status: "approval required", selectedAccess: false }
      ];

  return (
    <section className="plannerCard memoryVisualizer">
      <div className="panelHeader"><span>Memory Firewall Visualizer</span><strong>{dbPartitions.length ? "DB-backed grants" : selectedNode?.name ?? "Select a node"}</strong></div>
      <p>AgentDock partitions memory by workflow, sensitivity, and permission so each agent only receives the context it needs.</p>
      <div className="memoryZoneGrid">
        {zones.map((zone) => {
          return (
            <div className={`memoryZone ${zone.status.replaceAll(" ", "-")} ${zone.selectedAccess ? "selectedAccess" : ""}`} key={zone.name}>
              <strong>{zone.name}</strong>
              <span>{zone.selectedAccess ? "selected agent can access" : zone.status}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
