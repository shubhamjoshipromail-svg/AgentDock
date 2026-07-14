"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { addCredential, getSendingSetting, listCredentials, revokeCredential, setSendingSetting, type CredentialMetadata } from "../../lib/api/client";
import { Badge, Button, Card, Data, Select } from "../layout/primitives";
import { useToast } from "../layout/Toast";

// BYO provider key UI. The key input is write-only: we never display or echo it.
export function ProviderKeys() {
  const { data: session } = useSession();
  const toast = useToast();
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [provider, setProvider] = useState<"anthropic" | "openai" | "openrouter">("anthropic");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingEnabled, setSendingEnabledState] = useState(false);
  const [sendingBusy, setSendingBusy] = useState(false);

  const load = async () => {
    if (!session?.user) return setCredentials([]);
    try {
      const data = await listCredentials();
      setCredentials(data.credentials);
    } catch {
      setCredentials([]);
    }
    try {
      const { sendingEnabled } = await getSendingSetting();
      setSendingEnabledState(sendingEnabled);
    } catch {
      setSendingEnabledState(false);
    }
  };

  const onToggleSending = async () => {
    const next = !sendingEnabled;
    setSendingBusy(true);
    try {
      const { sendingEnabled: saved } = await setSendingSetting(next);
      setSendingEnabledState(saved);
      toast(
        saved
          ? "Real sending enabled. Every send still requires your approval."
          : "Real sending disabled. New flows will draft only.",
        "ok"
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to update sending setting.", "danger");
    } finally {
      setSendingBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [session?.user?.email]);

  const onAdd = async () => {
    if (key.trim().length < 20) return toast("That key looks too short.", "warn");
    setSaving(true);
    try {
      await addCredential(provider, key.trim());
      setKey("");
      toast("Provider key stored (encrypted). It is never displayed or logged.", "ok");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to store provider key.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      await revokeCredential(id);
      toast("Provider key revoked.", "ok");
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to revoke key.", "danger");
    }
  };

  const active = credentials.filter((credential) => credential.status === "active");

  return (
    <Card title="Provider keys" meta="BYO key">
      <p className="inspectorNote">
        Your key is encrypted at rest and used only to run your agents. AgentDock never displays or logs it.
      </p>
      {!session?.user && <p className="inspectorNote">Sign in to add a provider key.</p>}
      {session?.user && (
        <>
          <div className="providerKeyForm">
            <Select value={provider} onChange={(event) => setProvider(event.target.value as "anthropic" | "openai" | "openrouter")} aria-label="Provider">
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </Select>
            <input
              className="field providerKeyInput"
              type="password"
              autoComplete="off"
              placeholder="Paste API key (write-only)"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-label="Provider API key"
            />
            <Button variant="primary" size="sm" loading={saving} onClick={onAdd}>Save key</Button>
          </div>
          <div className="providerKeyList">
            {active.length === 0 && <p className="inspectorNote">No active provider key. Add one to run agents for real.</p>}
            {active.map((credential) => (
              <div className="providerKeyRow" key={credential.id}>
                <Badge tone="ok">{credential.provider}</Badge>
                <Data>•••• {credential.last4}</Data>
                <Button variant="danger" size="sm" onClick={() => onRevoke(credential.id)}>Revoke</Button>
              </div>
            ))}
          </div>
          <div className="providerKeyRow" style={{ marginTop: "0.75rem", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <strong style={{ fontSize: "0.85rem" }}>Real sending</strong>
                <Badge tone={sendingEnabled ? "ok" : "warn"}>{sendingEnabled ? "on" : "draft-only"}</Badge>
              </div>
              <p className="inspectorNote" style={{ margin: "0.2rem 0 0" }}>
                {sendingEnabled
                  ? "Flows may be granted tools that send externally. Every send still requires your approval."
                  : "New flows can draft (approval-gated) but cannot be granted a tool that sends externally. Turn this on to allow real sends."}
              </p>
            </div>
            <Button variant={sendingEnabled ? "ghost" : "primary"} size="sm" loading={sendingBusy} onClick={onToggleSending}>
              {sendingEnabled ? "Disable sending" : "Enable real sending"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
