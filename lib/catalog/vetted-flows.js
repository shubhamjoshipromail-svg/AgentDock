// The three managed MVP flows installed for every account. CommonJS keeps this
// usable from both Next.js/TypeScript and the plain-Node Prisma/backfill scripts.

const VETTED_FLOW_NAMES = [
  "Research & email me a summary",
  "Research → you choose → email your picks",
  "Brief → draft"
];

const TOPIC_FORM =
  '{"type":"intent","intentType":"form","payload":{"prompt":"What should I research?","fields":[{"name":"topic","label":"Research topic","type":"string","required":true}]}}';
const BRIEF_FORM =
  '{"type":"intent","intentType":"form","payload":{"prompt":"Tell me about the draft","fields":[{"name":"audience","label":"Audience","type":"string","required":true},{"name":"tone","label":"Tone","type":"string","required":true},{"name":"key_point","label":"Key point","type":"string","required":true}]}}';
const CHOICE_INTENT =
  '{"type":"intent","intentType":"choice","payload":{"prompt":"Choose up to three options to email","options":[{"id":"o1","title":"…","description":"…"}],"maxSelect":3}}';

// General-purpose agents, available to every user independently of any flow.
//
// The three vetted-flow agents have prompts hardwired to web_search /
// create_draft / send_email, which silently capped what the orchestrator could
// compose: connecting Calendar and Docs added tools but no agent that knew how to
// use them, so a composed calendar flow would be staffed by an agent instructed to
// send email. These agents are ROLE-shaped and TOOL-AGNOSTIC — they refer to "the
// tools you have been granted" and never to a specific tool name — so the
// composition space grows with the tool catalog instead of being pinned to it.
const AGENT_CONDUCT =
  "Use ONLY the tools listed in AVAILABLE TOOLS; they are whatever the human granted this step. " +
  "Never claim you performed an action before its tool result confirms it, and never invent a result. " +
  // False FAILURE is as dishonest as false success, and it is the failure this
  // caught in practice: an agent holding calendar:list_events reported "couldn't
  // access your calendar" without ever calling it. An untried tool is not a
  // failed tool.
  "NEVER say you lack access, cannot reach, or do not have something without CALLING the relevant tool first. " +
  "If a tool appears in AVAILABLE TOOLS you DO have it — call it and report what actually came back. " +
  "Only after a real tool result comes back as an error may you report that something failed, and then you quote the real reason. " +
  "Never ask the human for information you could obtain yourself with a tool you already hold. " +
  "If a tool is genuinely refused or errors, say so plainly and explain what you could not do. " +
  "If you are missing information no tool can give you, ask ONCE with a form or choice intent, then continue with the answer. " +
  "Never ask for something you were already told. Finish with an explicit final envelope containing the deliverable.";

const GENERAL_AGENTS = [
  {
    name: "Researcher",
    category: "Research",
    provider: "AgentDock",
    verified: true,
    description: "Gathers information using whichever read-only tools it has been granted, and asks the human to decide when a decision is theirs to make.",
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You gather information. ALWAYS start by actually calling your read tools — do not reason about whether to; call them and see what returns. " +
      "Gather first, ask second: if a tool you hold could answer a question, call it instead of asking the human. " +
      "When the goal depends on a choice only the human should make, present the REAL options your tools returned as a choice intent rather than deciding for them. " +
      AGENT_CONDUCT
  },
  {
    name: "Writer",
    category: "Writing",
    provider: "AgentDock",
    verified: true,
    description: "Turns gathered material into a written deliverable using whichever writing tool it has been granted.",
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You turn the material handed to you into a clear written deliverable. Use whichever writing tool you have been granted — a document, a draft, or plain text if you have no tool at all. " +
      "Write the actual content; never write a description of what you would write. Prefer the handoff you were given over re-researching. " +
      AGENT_CONDUCT
  },
  {
    name: "Coordinator",
    category: "Coordination",
    provider: "AgentDock",
    verified: true,
    description: "Schedules and delivers — booking time and sending things — using whichever scheduling or sending tools it has been granted.",
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You close the loop: schedule what needs scheduling and deliver what needs delivering, using the tools you have been granted. " +
      "Every action you take here is consequential and will pause for the human's approval — make the proposed action precise and easy to check, and never take an action the goal did not ask for. " +
      AGENT_CONDUCT
  }
];

const VETTED_FLOW_TEMPLATES = [
  {
    key: "research_email",
    name: VETTED_FLOW_NAMES[0],
    // NO topic here on purpose. The agent asks what to research (TOPIC_FORM)
    // instead of assuming one. A hardcoded subject made the flow look scripted
    // and skipped the clarification step entirely.
    goal: "Research a topic I give you and email me a concise summary of what you find.",
    agent: {
      name: "Research Email Assistant",
      category: "Research",
      provider: "AgentDock",
      verified: true,
      description: "Researches a concrete topic and prepares an email summary for the user.",
      model: "claude-sonnet-4-6",
      systemPrompt:
        "Research the topic in the flow goal with web_search, synthesize a concise source-aware summary, then email it to the USER EMAIL. " +
        "If no concrete topic exists in the goal or prior intent response, ask exactly once with this form intent: " + TOPIC_FORM + ". " +
        "After search succeeds, use send_email when that tool is available; otherwise use create_draft. Never claim delivery or draft creation before the tool succeeds. " +
        "Finish with an explicit final envelope that states whether an approved send or draft was actually created."
    },
    roleInWorkflow: "Research and prepare the email summary",
    tools: ["search", "draft", "send_when_enabled"]
  },
  {
    key: "research_choose_email",
    name: VETTED_FLOW_NAMES[1],
    // NO topic here on purpose — see above. Previously this said "notable AI
    // agent platform companies", so the run never asked what to research and
    // went straight to offering AI platforms as the choice.
    goal: "Research a topic I give you, let me choose up to three of the options you find, then email only my picks.",
    agent: {
      name: "Research Choice Assistant",
      category: "Concierge",
      provider: "AgentDock",
      verified: true,
      description: "Researches options, asks the user to choose, then prepares an email of only those picks.",
      model: "claude-sonnet-4-6",
      systemPrompt:
        "Use web_search to research 4-6 real options for the concrete topic in the goal. If the topic is missing, ask with this form intent: " + TOPIC_FORM + ". " +
        "After research, do not choose for the user. Emit a choice intent in this exact shape, filled with the researched options: " + CHOICE_INTENT + ". " +
        "After the user responds, email ONLY the selected options to the USER EMAIL: use send_email when available, otherwise create_draft. " +
        "Never email unselected options and never claim the action succeeded before its tool result. Finish with an explicit final envelope."
    },
    roleInWorkflow: "Research, ask for a choice, and prepare the selected email",
    tools: ["search", "draft", "send_when_enabled"]
  },
  {
    key: "brief_draft",
    name: VETTED_FLOW_NAMES[2],
    goal: "Ask me for a three-field brief, then create a Gmail draft from my answers.",
    agent: {
      name: "Brief Draft Assistant",
      category: "Writing",
      provider: "AgentDock",
      verified: true,
      description: "Collects a structured brief and creates a reviewable Gmail draft.",
      model: "claude-sonnet-4-6",
      systemPrompt:
        "Inspect the goal and handoff before asking anything. If essential draft information is genuinely missing, ask once with a form containing only the missing fields; this is an example shape, not a mandatory form: " + BRIEF_FORM + ". " +
        "If a usable brief or research handoff already exists, do not ask for audience, tone, or key point again; use a neutral professional tone and continue. Use create_draft to prepare one Gmail draft for the USER EMAIL. " +
        "Do not fabricate missing answers, do not send the email, and do not claim a draft exists before the tool succeeds. Finish with an explicit final envelope."
    },
    roleInWorkflow: "Collect the brief and create a Gmail draft",
    tools: ["draft"]
  }
];

const TOOL_DEFINITIONS = {
  search: {
    server: {
      name: "search-mcp",
      displayName: "Search MCP",
      description: "Public web discovery through the first-party search MCP server.",
      registrySource: "agentdock-curated",
      registryId: "agentdock:search-mcp",
      category: "Public info",
      riskLevel: "low",
      verificationStatus: "verified",
      recommendedPermission: "read_only",
      mcpServerKey: "search",
      mcpToolName: "web_search",
      isExternalSend: false,
      credentialProvider: null
    },
    tool: {
      name: "web_search",
      description: "Search the public web for a query and return result snippets.",
      riskLevel: "low",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "The public-web search query." } },
        required: ["query"],
        additionalProperties: false
      }
    },
    grant: { canRead: true, canWrite: false, canExecute: false, canDelete: false, requiresApproval: false }
  },
  draft: {
    server: {
      name: "gmail-create-draft",
      displayName: "Gmail: create_draft",
      description: "Creates a Gmail draft for human review; it never sends.",
      registrySource: "discovered",
      registryId: "agentdock:discovered:gmail:create_draft",
      category: "Communications",
      riskLevel: "low",
      verificationStatus: "verified",
      recommendedPermission: "draft_only",
      mcpServerKey: "gmail",
      mcpToolName: "create_draft",
      isExternalSend: false,
      credentialProvider: "google"
    },
    tool: {
      name: "create_draft",
      description: "Create a Gmail draft for review without sending it.",
      riskLevel: "low",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" }
        },
        required: ["to", "subject", "body"],
        additionalProperties: false
      }
    },
    grant: { canRead: true, canWrite: true, canExecute: false, canDelete: false, requiresApproval: false }
  },
  send: {
    server: {
      name: "gmail-send-email",
      displayName: "Gmail: send_email",
      description: "Sends a real email only after explicit human approval.",
      registrySource: "discovered",
      registryId: "agentdock:discovered:gmail:send_email",
      category: "Communications",
      riskLevel: "medium",
      verificationStatus: "verified",
      recommendedPermission: "approval_required",
      mcpServerKey: "gmail",
      mcpToolName: "send_email",
      isExternalSend: true,
      credentialProvider: "google"
    },
    tool: {
      name: "send_email",
      description: "Send an email from the connected Gmail account after approval.",
      riskLevel: "medium",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" }
        },
        required: ["to", "subject", "body"],
        additionalProperties: false
      }
    },
    grant: { canRead: true, canWrite: true, canExecute: false, canDelete: false, requiresApproval: true }
  }
};

const SERVER_REGISTRATIONS = [
  {
    serverKey: "gmail",
    displayName: "Gmail",
    transport: "stdio",
    command: process.env.GMAIL_MCP_COMMAND || process.execPath,
    args: (process.env.GMAIL_MCP_ARGS || "servers/gmail/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: "google",
    tokenEnvVar: "GMAIL_ACCESS_TOKEN",
    // Isolation floor (Chunk 22): must match lib/registry/server-registrations.ts.
    // Gmail reads only the brokered GMAIL_ACCESS_TOKEN.
    envAllowlist: [],
    enabled: true,
    curated: true
  },
  {
    serverKey: "search",
    displayName: "Web Search",
    transport: "stdio",
    command: process.env.SEARCH_MCP_COMMAND || process.execPath,
    args: (process.env.SEARCH_MCP_ARGS || "servers/search/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: null,
    tokenEnvVar: null,
    // Isolation floor (Chunk 22): must match lib/registry/server-registrations.ts.
    envAllowlist: ["RUN_TOOL_COST_CENTS"],
    enabled: true,
    curated: true
  },
  {
    // Must stay in step with lib/registry/server-registrations.ts — a test asserts it.
    serverKey: "calendar",
    displayName: "Google Calendar",
    transport: "stdio",
    command: process.env.CALENDAR_MCP_COMMAND || process.execPath,
    args: (process.env.CALENDAR_MCP_ARGS || "servers/calendar/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: "google",
    tokenEnvVar: "GOOGLE_ACCESS_TOKEN",
    envAllowlist: [],
    enabled: true,
    curated: true
  },
  {
    serverKey: "docs",
    displayName: "Google Docs",
    transport: "stdio",
    command: process.env.DOCS_MCP_COMMAND || process.execPath,
    args: (process.env.DOCS_MCP_ARGS || "servers/docs/dist/index.js").split(" ").filter(Boolean),
    credentialProvider: "google",
    tokenEnvVar: "GOOGLE_ACCESS_TOKEN",
    envAllowlist: [],
    enabled: true,
    curated: true
  }
];

async function upsertTool(tx, definition) {
  const server = await tx.mcpServer.upsert({
    where: {
      registrySource_registryId: {
        registrySource: definition.server.registrySource,
        registryId: definition.server.registryId
      }
    },
    update: definition.server,
    create: definition.server
  });
  await tx.mcpTool.upsert({
    where: { mcpServerId_name: { mcpServerId: server.id, name: definition.tool.name } },
    update: definition.tool,
    create: { mcpServerId: server.id, ...definition.tool }
  });
  return server;
}

async function ensureVettedFlowsForUser(prisma, userId) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked",
      `agentdock:vetted-flows:${userId}`
    );
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { sendingEnabled: true } });
    for (const registration of SERVER_REGISTRATIONS) {
      await tx.serverRegistration.upsert({
        where: { serverKey: registration.serverKey },
        update: registration,
        create: registration
      });
    }
    const installedTools = {
      search: await upsertTool(tx, TOOL_DEFINITIONS.search),
      draft: await upsertTool(tx, TOOL_DEFINITIONS.draft),
      send: await upsertTool(tx, TOOL_DEFINITIONS.send)
    };

    // General-purpose agents exist for every user regardless of flows, so the
    // orchestrator has staff for compositions nobody wrote a template for.
    for (const { name: generalName, ...generalDefaults } of GENERAL_AGENTS) {
      await tx.agent.upsert({
        where: { userId_name: { userId, name: generalName } },
        update: generalDefaults,
        create: { userId, name: generalName, ...generalDefaults }
      });
    }
    const createdWorkflowNames = [];
    const workflows = [];

    for (const template of VETTED_FLOW_TEMPLATES) {
      const { name: agentName, ...agentDefaults } = template.agent;
      const agent = await tx.agent.upsert({
        where: { userId_name: { userId, name: agentName } },
        update: agentDefaults,
        create: { userId, name: agentName, ...agentDefaults }
      });
      let workflow = await tx.workflow.findFirst({ where: { userId, name: template.name } });
      if (workflow) {
        workflow = await tx.workflow.update({
          where: { id: workflow.id },
          data: {
            goal: template.goal,
            weeklyBudgetCents: 500,
            maxRunBudgetCents: 100,
            approvalMode: "approval_gated"
          }
        });
      } else {
        workflow = await tx.workflow.create({
          data: {
            userId,
            name: template.name,
            goal: template.goal,
            status: "active",
            weeklyBudgetCents: 500,
            maxRunBudgetCents: 100,
            approvalMode: "approval_gated"
          }
        });
        createdWorkflowNames.push(template.name);
      }
      workflows.push(workflow);

      await tx.workflowAgent.deleteMany({ where: { workflowId: workflow.id, agentId: { not: agent.id } } });
      await tx.workflowAgent.upsert({
        where: { workflowId_agentId: { workflowId: workflow.id, agentId: agent.id } },
        update: { roleInWorkflow: template.roleInWorkflow, routeOrder: 1, defaultMode: "auto" },
        create: {
          workflowId: workflow.id,
          agentId: agent.id,
          roleInWorkflow: template.roleInWorkflow,
          routeOrder: 1,
          defaultMode: "auto"
        }
      });

      const desiredToolKeys = template.tools.flatMap((key) =>
        key === "send_when_enabled" ? (user.sendingEnabled ? ["send"] : []) : [key]
      );
      const desiredServerIds = desiredToolKeys.map((key) => installedTools[key].id);
      await tx.mcpAccessGrant.deleteMany({
        where: {
          userId,
          workflowId: workflow.id,
          ...(desiredServerIds.length ? { mcpServerId: { notIn: desiredServerIds } } : {})
        }
      });
      for (const key of desiredToolKeys) {
        const definition = TOOL_DEFINITIONS[key];
        const mcpServerId = installedTools[key].id;
        // Mandate scope = canonical tool identity. The broker denies a scopeless
        // grant, so a seeded grant must carry it too (Chunk 22 Phase 5).
        const grantScope = `${definition.server.mcpServerKey}:${definition.server.mcpToolName}`;
        await tx.mcpAccessGrant.upsert({
          where: { userId_workflowId_mcpServerId: { userId, workflowId: workflow.id, mcpServerId } },
          update: { agentId: agent.id, ...definition.grant, scope: grantScope },
          create: { userId, workflowId: workflow.id, agentId: agent.id, mcpServerId, ...definition.grant, scope: grantScope }
        });
      }
    }

    return { workflows, createdWorkflowNames };
  });
}

module.exports = {
  VETTED_FLOW_NAMES,
  VETTED_FLOW_TEMPLATES,
  GENERAL_AGENTS,
  ensureVettedFlowsForUser
};
