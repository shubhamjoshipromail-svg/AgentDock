export type AgentDefault = {
  name: string;
  category: string;
  provider: string;
  verified: boolean;
  description: string;
  model?: string;
  systemPrompt?: string;
};

export const agentDefaults: AgentDefault[];
export const agentDefaultsByName: Record<string, AgentDefault | undefined>;
