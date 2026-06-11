// Single source of truth for the demo agent catalog defaults.
// CommonJS so that prisma/seed.js (plain Node) and the Next.js routes can
// both import it without a build step. Typed via agent-defaults.d.ts.
const agentDefaults = [
  {
    name: "Job Discovery Agent",
    category: "Discovery",
    provider: "OpenAI",
    verified: true,
    description: "Finds matching AI infrastructure roles and ranks fit."
  },
  {
    name: "Resume Tailoring Agent",
    category: "Documents",
    provider: "OpenAI",
    verified: true,
    description: "Tailors resume drafts with approval gates."
  },
  {
    name: "Company Research Agent",
    category: "Research",
    provider: "Claude",
    verified: true,
    description: "Builds company briefs and hiring signal summaries."
  },
  {
    name: "Outreach Draft Agent",
    category: "Communications",
    provider: "Gemini",
    verified: true,
    description: "Drafts recruiter outreach without sending."
  },
  {
    name: "Shopping Agent",
    category: "Commerce",
    provider: "Open-source",
    verified: false,
    description: "Compares products and prices with strict memory isolation."
  },
  {
    name: "Finance Agent",
    category: "Finance",
    provider: "Claude",
    verified: true,
    description: "Summarizes finance tasks with restricted memory defaults."
  },
  {
    name: "Health Agent",
    category: "Health",
    provider: "OpenAI",
    verified: true,
    description: "Handles health notes with restricted memory defaults."
  }
];

const agentDefaultsByName = Object.fromEntries(agentDefaults.map((agent) => [agent.name, agent]));

module.exports = { agentDefaults, agentDefaultsByName };
