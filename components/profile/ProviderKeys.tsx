"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { addCredential, listCredentials, revokeCredential, type CredentialMetadata } from "../../lib/api/client";
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

  const load = async () => {
    if (!session?.user) return setCredentials([]);
    try {
      const data = await listCredentials();
      setCredentials(data.credentials);
    } catch {
      setCredentials([]);
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
        </>
      )}
    </Card>
  );
}
