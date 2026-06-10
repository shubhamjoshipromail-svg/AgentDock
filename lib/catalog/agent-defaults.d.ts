export type AgentDefault = {
  name: string;
  category: string;
  provider: string;
  trustScore: number;
  costPerTask: number;
  tokenEfficiency: number;
  verified: boolean;
  description: string;
};

export const agentDefaults: AgentDefault[];
export const agentDefaultsByName: Record<string, AgentDefault | undefined>;
