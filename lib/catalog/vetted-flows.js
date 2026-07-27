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

const VETTED_FLOW_TEMPLATES = [
  {
    key: "research_email",
    name: VETTED_FLOW_NAMES[0],
    goal: "Research the latest developments in governed AI agent platforms and email me a concise summary.",
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
    goal: "Research notable AI agent platform companies, let me choose up to three, then email only my picks.",
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
  ensureVettedFlowsForUser
};
