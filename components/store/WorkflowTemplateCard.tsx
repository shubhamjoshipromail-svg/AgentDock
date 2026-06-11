"use client";

import { workflowTemplates } from "../mock-data";
import { ComingSoonButton, Metric } from "../layout/primitives";

export function WorkflowTemplateCard({ workflow }: { workflow: typeof workflowTemplates[number] }) {
  return (
    <article className="agentCard">
      <div className="agentTopline">
        <span className="verifiedBadge">Template</span>
        <ComingSoonButton>Install Flow</ComingSoonButton>
      </div>
      <h3>{workflow.name}</h3>
      <div className="agentStats expanded">
        <Metric label="Agents" value={workflow.agents} />
        <Metric label="Tools" value={workflow.mcps} />
        <Metric label="Memory" value={workflow.memory} />
        <Metric label="Access" value={workflow.permissions} />
        <Metric label="Budget" value={workflow.budget} />
      </div>
    </article>
  );
}
