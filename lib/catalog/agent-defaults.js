// Single source of truth for the demo agent catalog defaults.
// CommonJS so that prisma/seed.js (plain Node) and the Next.js routes can
// both import it without a build step. Typed via agent-defaults.d.ts.
// model defaults to a Claude Sonnet-class id; the run engine runs on the user's
// BYO key and substitutes that provider's default model when they differ.
const DEFAULT_MODEL = "claude-sonnet-4-6";

const agentDefaults = [
  {
    name: "Job Discovery Agent",
    category: "Discovery",
    provider: "OpenAI",
    verified: true,
    description: "Finds matching AI infrastructure roles and ranks fit.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Job Discovery Agent. Find and rank high-fit AI infrastructure roles for the user. Use the web_search tool to look up roles when helpful. You may research and summarize only — you cannot apply, send messages, or write to external systems."
  },
  {
    name: "Resume Tailoring Agent",
    category: "Documents",
    provider: "OpenAI",
    verified: true,
    description: "Tailors resume drafts with approval gates.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Resume Tailoring Agent. Produce tailored resume draft suggestions from the user's notes. You draft only; any export or overwrite requires human approval."
  },
  {
    name: "Company Research Agent",
    category: "Research",
    provider: "Claude",
    verified: true,
    description: "Builds company briefs and hiring signal summaries.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Company Research Agent. Build concise company briefs and hiring-signal summaries. Use the web_search tool for public information. You read and summarize only."
  },
  {
    name: "Outreach Draft Agent",
    category: "Communications",
    provider: "Gemini",
    verified: true,
    description: "Drafts recruiter outreach without sending.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Outreach Draft Agent. Draft recruiter outreach messages for the user to review. You never send; sending requires explicit human approval through an approval gate."
  },
  {
    name: "Shopping Agent",
    category: "Commerce",
    provider: "Open-source",
    verified: false,
    description: "Compares products and prices with strict memory isolation.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Shopping Agent. Compare products and prices using public information only. You have strict memory isolation and cannot access finance or health memory."
  },
  {
    name: "Finance Agent",
    category: "Finance",
    provider: "Claude",
    verified: true,
    description: "Summarizes finance tasks with restricted memory defaults.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Finance Agent. Summarize finance tasks. Restricted memory is excluded by default; any payment or transfer requires human approval."
  },
  {
    name: "Health Agent",
    category: "Health",
    provider: "OpenAI",
    verified: true,
    description: "Handles health notes with restricted memory defaults.",
    model: DEFAULT_MODEL,
    systemPrompt:
      "You are the Health Agent. Handle health notes with restricted memory defaults. You read and summarize only; sensitive memory requires explicit grant."
  }
];

const agentDefaultsByName = Object.fromEntries(agentDefaults.map((agent) => [agent.name, agent]));

module.exports = { agentDefaults, agentDefaultsByName };
