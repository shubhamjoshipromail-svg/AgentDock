// Single source of truth for the demo agent catalog defaults.
// CommonJS so that prisma/seed.js (plain Node) and the Next.js routes can
// both import it without a build step. Typed via agent-defaults.d.ts.
const agentDefaults = [
  {
    name: "Job Discovery Agent",
    category: "Discovery",
    provider: "OpenAI",
    trustScore: 96,
    costPerTask: 9,
    tokenEfficiency: 91,
    verified: true,
    description: "Finds matching AI infrastructure roles and ranks fit."
  },
  {
    name: "Resume Tailoring Agent",
    category: "Documents",
    provider: "OpenAI",
    trustScore: 89,
    costPerTask: 24,
    tokenEfficiency: 78,
    verified: true,
    description: "Tailors resume drafts with approval gates."
  },
  {
    name: "Company Research Agent",
    category: "Research",
    provider: "Claude",
    trustScore: 92,
    costPerTask: 18,
    tokenEfficiency: 84,
    verified: true,
    description: "Builds company briefs and hiring signal summaries."
  },
  {
    name: "Outreach Draft Agent",
    category: "Communications",
    provider: "Gemini",
    trustScore: 94,
    costPerTask: 11,
    tokenEfficiency: 88,
    verified: true,
    description: "Drafts recruiter outreach without sending."
  },
  {
    name: "Shopping Agent",
    category: "Commerce",
    provider: "Open-source",
    trustScore: 81,
    costPerTask: 7,
    tokenEfficiency: 82,
    verified: false,
    description: "Compares products and prices with strict memory isolation."
  },
  {
    name: "Finance Agent",
    category: "Finance",
    provider: "Claude",
    trustScore: 86,
    costPerTask: 16,
    tokenEfficiency: 80,
    verified: true,
    description: "Summarizes finance tasks with restricted memory defaults."
  },
  {
    name: "Health Agent",
    category: "Health",
    provider: "OpenAI",
    trustScore: 88,
    costPerTask: 20,
    tokenEfficiency: 76,
    verified: true,
    description: "Handles health notes with restricted memory defaults."
  }
];

const agentDefaultsByName = Object.fromEntries(agentDefaults.map((agent) => [agent.name, agent]));

module.exports = { agentDefaults, agentDefaultsByName };
