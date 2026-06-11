"use client";

import { credentials, providerUsage } from "../mock-data";
import { Card, CapabilityBadge, PageHeader, WorkflowMini } from "../layout/primitives";

export function KeysBilling({ spend }: { spend: number }) {
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Access" title="Access Gateway" copy="Agents never receive raw keys. AgentDock issues scoped, revocable access." />
      <div className="truthNotice">
        <CapabilityBadge kind="soon" />
        <strong>Coming soon / metadata preview.</strong>
        <span>This page previews the Access Gateway. Real provider connections, billing, and credential minting are not active yet.</span>
      </div>
      <div className="providerGrid">
        {["OpenAI", "Anthropic", "Gemini", "OpenRouter", "Google Workspace", "GitHub", "Stripe later"].map((provider) => (
          <div className="providerCard" key={provider}>
            <strong>{provider}</strong>
            <span>{provider === "Stripe later" ? "Planned" : "Metadata preview"}</span>
          </div>
        ))}
      </div>
      <Card title="Scoped Access" meta="No raw keys exposed">
        <div className="tableWrap platformTable">
          <table>
            <thead><tr><th>Provider</th><th>Agent</th><th>Flow</th><th>Scope</th><th>Expiry</th><th>Status</th></tr></thead>
            <tbody>
              {credentials.map((credential) => (
                <tr key={`${credential.provider}-${credential.agent}`}>
                  <td>{credential.provider}</td><td>{credential.agent}</td><td>{credential.workflow}</td><td>{credential.scope}</td><td>{credential.expiry}</td><td>{credential.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="dashboardGrid">
        <Card title="Spend caps" meta="Policy enforced">
          <WorkflowMini name="Job Search Automation" status="Active" budget={`$${spend.toFixed(2)} / $5.00`} />
          <WorkflowMini name="Research Brief Generator" status="Ready" budget="$0.42 / $3.00" />
          <WorkflowMini name="Coding Review Stack" status="Paused" budget="$0.00 / $7.00" />
        </Card>
        <Card title="Provider usage breakdown" meta="Mock usage">
          {providerUsage.map((usage) => (
            <div className="compactItem" key={usage.provider}>
              <div><strong>{usage.provider}</strong><span>{usage.usage} used</span></div>
              <span>{usage.cap}</span>
            </div>
          ))}
        </Card>
      </div>
    </section>
  );
}
