import type { PrismaClient, Workflow } from "@prisma/client";

export const VETTED_FLOW_NAMES: readonly [
  "Research & email me a summary",
  "Research → you choose → email your picks",
  "Brief → draft"
];

export type VettedFlowTemplate = {
  key: string;
  name: string;
  goal: string;
  agent: {
    name: string;
    category: string;
    provider: string;
    verified: boolean;
    description: string;
    model: string;
    systemPrompt: string;
  };
  roleInWorkflow: string;
  tools: string[];
};

export const VETTED_FLOW_TEMPLATES: VettedFlowTemplate[];

export function ensureVettedFlowsForUser(
  prisma: PrismaClient,
  userId: string
): Promise<{ workflows: Workflow[]; createdWorkflowNames: string[] }>;
