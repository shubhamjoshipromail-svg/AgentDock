"use client";

import { Card, PageHeader } from "../layout/primitives";

export function Architecture() {
  const stack = ["Control", "Orchestration Agent", "Policy Engine", "Memory Firewall + Access Gateway", "AgentDock Runtime / Sandbox", "Agent Router", "Agents", "Tool Gateway", "Tools / Models / Apps"];
  return (
    <section className="platformPage">
      <PageHeader eyebrow="Architecture" title="A policy layer for agents, credentials, memory, runtimes, tools, and models." copy="A2A coordinates agents. MCP connects tools. A2UI keeps the user in control. AgentDock’s policy layer decides what is allowed. The Memory Firewall decides what context each agent can access." />
      <div className="architectureFlow polished">
        {stack.map((node, index) => (
          <div className="architectureNode" key={node}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{node}</strong>
          </div>
        ))}
      </div>
      <div className="architectureNotes">
        <Card title="A2A" meta="Agent coordination"><p>Routes handoffs across third-party agents while preserving approval gates and policy context.</p></Card>
        <Card title="MCP" meta="Tool access"><p>Connects external tools through scoped, revocable permissions rather than broad raw keys.</p></Card>
        <Card title="Runtime" meta="Sandbox selected"><p>AgentDock is not trying to be a raw GPU cloud. It manages where and how agent workflows run: provider APIs, AgentDock sandbox, user cloud, or local runtime.</p></Card>
        <Card title="A2UI" meta="User control"><p>Keeps approvals, memory, spend, credentials, and logs visible to the human operator.</p></Card>
      </div>
    </section>
  );
}
