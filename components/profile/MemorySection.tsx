"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { loadMemory, patchMemoryGrant, revokeMemoryGrant } from "../../lib/api/client";
import { memoryPartitions } from "../mock-data";
import type { PersistedMemoryGrant, PersistedMemoryPartition, PersistedMemoryPayload } from "../../lib/types";
import { Button, ComingSoonButton, DetailBlock } from "../layout/primitives";
import { useToast } from "../layout/Toast";

export function MemorySection({ selectedMemory, onSelectMemory }: { selectedMemory: string; onSelectMemory: (name: string) => void }) {
  const { data: session } = useSession();
  const toast = useToast();
  const [memoryData, setMemoryData] = useState<PersistedMemoryPayload | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [updatingGrantId, setUpdatingGrantId] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState("");
  const activeMockPartition = memoryPartitions.find((partition) => partition.name === selectedMemory) ?? memoryPartitions[1];
  const activeDbPartition = memoryData?.partitions.find((partition) => partition.name === selectedMemory) ?? memoryData?.partitions[0];
  const dbBacked = Boolean(session?.user && memoryData?.partitions.length);

  const loadMemoryData = async () => {
    if (!session?.user) {
      setMemoryData(null);
      return;
    }

    setLoadingMemory(true);

    try {
      const data = await loadMemory("Unable to load memory policy.");
      setMemoryData(data);
      if (data.partitions?.length && !data.partitions.some((partition: PersistedMemoryPartition) => partition.name === selectedMemory)) {
        onSelectMemory(data.partitions[0].name);
      }
      if (data.bootstrapped) {
toast("Created starter DB-backed Memory Zones for this profile.", "ok");
      }
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to load memory policy. Showing mock fallback.", "danger");
      setMemoryData(null);
    } finally {
      setLoadingMemory(false);
    }
  };

  useEffect(() => {
    loadMemoryData();
  }, [session?.user?.email]);

  const patchGrant = async (grant: PersistedMemoryGrant, field: keyof Pick<PersistedMemoryGrant, "canRead" | "canWrite" | "canEdit" | "canDelete" | "canShare" | "requiresApproval">) => {
    setUpdatingGrantId(grant.id);

    try {
      await patchMemoryGrant(grant.id, { [field]: !grant[field] }, "Unable to update memory grant.");
toast("Memory access updated and logged.", "ok");
      await loadMemoryData();
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to update memory grant.", "danger");
    } finally {
      setUpdatingGrantId("");
    }
  };

  const revokeGrant = async (grantId: string) => {
    setUpdatingGrantId(grantId);

    try {
      await revokeMemoryGrant(grantId, "Unable to revoke memory grant.");
toast("Access revoked and written to Timeline.", "ok");
      await loadMemoryData();
    } catch (error) {
toast(error instanceof Error ? error.message : "Unable to revoke memory grant.", "danger");
    } finally {
      setUpdatingGrantId("");
    }
  };

  return (
    <section className="memorySection">
      <div className="memoryFirewallCard">
        <div>
          <p className="eyebrow">Memory Firewall</p>
          <h3>Agents only receive the context they need.</h3>
          <p>AgentDock partitions memory by Flow, sensitivity, and access so agents only see what they need.</p>
        </div>
        <div className="dbStatus">
          <span>{dbBacked ? "DB-backed Memory Zones" : "Demo Memory Zones"}</span>
          <strong>{dbBacked ? `${memoryData?.partitions.length ?? 0} zones loaded from Postgres` : "Mock-backed UI"}</strong>
          <p>{dbBacked ? "Access, items, and memory logs are loaded for the signed-in user." : "Sign in to load zones, access, items, and logs from Postgres."}</p>
        </div>
      </div>
      {loadingMemory && <div className="sectionLoading">Loading Memory Zones…</div>}
      <div className="memoryLayout">
        <div className="card">
          <div className="panelHeader">
            <span>Memory Zones</span>
            <strong>{dbBacked ? `${memoryData?.partitions.length ?? 0} DB zones` : `${memoryPartitions.length} mock zones`}</strong>
          </div>
          <div className="memoryTable">
            {dbBacked && memoryData ? (
              memoryData.partitions.map((partition) => (
                <button className={`memoryRow ${partition.name === activeDbPartition?.name ? "selected" : ""}`} key={partition.id} onClick={() => onSelectMemory(partition.name)}>
                  <div><strong>{partition.name}</strong><span>{partition.description}</span></div>
                  <span className={`sensitivityBadge ${partition.sensitivityLevel}`}>{partition.sensitivityLevel}</span>
                  <span>{partition.workflow?.name ?? "Global / domain"}</span>
                  <span>{partition.defaultAccessPolicy.replaceAll("_", " ")}</span>
                  <span className="rowActions">{partition.accessGrants.length} grants</span>
                </button>
              ))
            ) : (
              memoryPartitions.map((partition) => (
                <button className={`memoryRow ${partition.name === activeMockPartition.name ? "selected" : ""}`} key={partition.name} onClick={() => onSelectMemory(partition.name)}>
                  <div><strong>{partition.name}</strong><span>{partition.description}</span></div>
                  <span className={`sensitivityBadge ${partition.sensitivity}`}>{partition.sensitivity}</span>
                  <span>{partition.access}</span>
                  <span>{partition.permissionLevel}</span>
                  <span className="rowActions">Edit / Revoke</span>
                </button>
              ))
            )}
          </div>
        </div>
        <aside className="card memoryDetail">
          <div className="panelHeader"><span>Zone detail</span><strong>{dbBacked ? activeDbPartition?.name : activeMockPartition.name}</strong></div>
          {dbBacked && activeDbPartition ? (
            <>
              <div className="detailStack">
                <DetailBlock label="Flow" value={activeDbPartition.workflow?.name ?? "Global / domain memory"} />
                <DetailBlock label="Sensitivity" value={activeDbPartition.sensitivityLevel} />
                <DetailBlock label="Default access" value={activeDbPartition.defaultAccessPolicy.replaceAll("_", " ")} />
              </div>
              <div className="permissionList">
                <span>Items</span>
                {activeDbPartition.memoryItems.length ? activeDbPartition.memoryItems.map((item) => (
                  <p key={item.id}><strong>{item.title}</strong><br />{item.content}</p>
                )) : <p>No memory items in this partition yet.</p>}
              </div>
              <div className="permissionList">
                <span>Access</span>
                {activeDbPartition.accessGrants.length ? activeDbPartition.accessGrants.map((grant) => (
                  <div className="grantEditor" key={grant.id}>
                    <div>
                      <strong>{grant.agent?.name ?? grant.workflow?.name ?? "Flow grant"}</strong>
                      <span>{grant.workflow?.name ?? "No Flow scope"}</span>
                    </div>
                    <div className="grantToggleGrid">
                      {(["canRead", "canWrite", "canEdit", "canDelete", "canShare", "requiresApproval"] as const).map((field) => (
                        <button
                          className={grant[field] ? "grantToggle active" : "grantToggle"}
                          disabled={updatingGrantId === grant.id}
                          key={field}
                          onClick={() => patchGrant(grant, field)}
                        >
                          {field.replace("can", "").replace("requiresApproval", "approval")}
                        </button>
                      ))}
                    </div>
                    {confirmRevokeId === grant.id ? (
                      <div className="confirmRow">
                        <p>Revoke access? The next action under this grant will be blocked.</p>
                        <Button variant="danger" size="sm" loading={updatingGrantId === grant.id} onClick={() => { setConfirmRevokeId(""); revokeGrant(grant.id); }}>Revoke access</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRevokeId("")}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => setConfirmRevokeId(grant.id)}>Revoke access</Button>
                    )}
                  </div>
                )) : <p>No agents currently have direct grants to this partition.</p>}
              </div>
              <div className="permissionList">
                <span>Recent logs</span>
                {activeDbPartition.accessLogs.length ? activeDbPartition.accessLogs.map((log) => (
                  <p key={log.id}>{log.agent?.name ?? "AgentDock"} - {log.action} - {log.decision}: {log.reason}</p>
                )) : <p>No recent memory logs for this partition.</p>}
              </div>
            </>
          ) : (
            <>
              <div className="detailStack">
                <DetailBlock label="Flow" value={activeMockPartition.workflow} />
                <DetailBlock label="Allowed agents" value={activeMockPartition.allowedAgents.length ? activeMockPartition.allowedAgents.join(", ") : "None by default"} />
                <DetailBlock label="Blocked agents" value={activeMockPartition.blockedAgents.join(", ")} />
              </div>
              <div className="permissionList">
                <span>Access</span>
                {activeMockPartition.permissions.map((permission) => <p key={permission}>{permission}</p>)}
              </div>
              <div className="actionRow detailActions">
                <ComingSoonButton>Edit Access</ComingSoonButton>
                <ComingSoonButton>Revoke Access</ComingSoonButton>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
