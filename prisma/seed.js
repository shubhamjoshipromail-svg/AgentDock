const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const { agentDefaults } = require("../lib/catalog/agent-defaults");

const connectionString = process.env.DATABASE_URL ?? "postgresql://agentdock:agentdock@localhost:5432/agentdock?schema=public";
const acceptsInvalidCerts = connectionString.includes("sslaccept=accept_invalid_certs");
const adapterConnectionString = acceptsInvalidCerts
  ? connectionString.replace(/[?&]sslmode=require/g, "").replace(/[?&]sslaccept=accept_invalid_certs/g, "")
  : connectionString;

const adapter = new PrismaPg({
  connectionString: adapterConnectionString,
  ssl: acceptsInvalidCerts ? { rejectUnauthorized: false } : undefined
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "shubham@example.com" },
    update: {},
    create: {
      name: "Shubham Joshi",
      email: "shubham@example.com"
    }
  });

  // Chunk 15: server registration AS DATA. Seed the first-party entries as
  // ServerRegistration rows (curated/admin only — never user-submitted). Adding a
  // new server here makes it connectable through the generic flow with no code
  // change. Mirrors lib/registry/server-registrations.ts (the runtime fallback).
  const serverRegistrations = [
    {
      serverKey: "gmail",
      displayName: "Gmail",
      transport: "stdio",
      command: process.env.GMAIL_MCP_COMMAND ?? process.execPath,
      args: (process.env.GMAIL_MCP_ARGS ?? "servers/gmail/dist/index.js").split(" ").filter(Boolean),
      credentialProvider: "google",
      tokenEnvVar: "GMAIL_ACCESS_TOKEN",
      enabled: true,
      curated: true
    },
    {
      serverKey: "search",
      displayName: "Web Search",
      transport: "stdio",
      command: process.env.SEARCH_MCP_COMMAND ?? process.execPath,
      args: (process.env.SEARCH_MCP_ARGS ?? "servers/search/dist/index.js").split(" ").filter(Boolean),
      credentialProvider: null,
      tokenEnvVar: null,
      enabled: true,
      curated: true
    }
  ];
  for (const reg of serverRegistrations) {
    await prisma.serverRegistration.upsert({
      where: { serverKey: reg.serverKey },
      update: reg,
      create: reg
    });
  }

  // Seed first-party Gmail McpServer catalog rows with full MCP execution identity.
  // These are the rows the run engine loads via McpAccessGrant → McpServer; without
  // mcpServerKey/mcpToolName/isExternalSend the tool is uncallable at runtime.
  // Canonical Gmail tool rows use the SAME identity the live connect→discover
  // flow produces (registrySource "discovered", registryId agentdock:discovered:
  // gmail:<tool>, name gmail-<tool>). Seeding them under that identity means a
  // later real discovery UPSERTS the same rows instead of creating duplicates —
  // one create_draft row and one send_email row, never four.
  const gmailMcpServers = [
    {
      name: "gmail-create-draft",
      displayName: "Gmail: create_draft",
      description: "Creates email drafts only. Safe, reversible — no approval needed.",
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
    {
      name: "gmail-send-email",
      displayName: "Gmail: send_email",
      description: "Sends a real email from the user's account. Always approval-gated — never auto-sends.",
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
    }
  ];
  for (const srv of gmailMcpServers) {
    await prisma.mcpServer.upsert({
      where: { registrySource_registryId: { registrySource: srv.registrySource, registryId: srv.registryId } },
      update: srv,
      create: srv
    });
  }

  const agents = {};
  for (const { name, ...defaults } of agentDefaults) {
    agents[name] = await prisma.agent.upsert({
      where: { userId_name: { userId: user.id, name } },
      update: defaults,
      create: { userId: user.id, name, ...defaults }
    });
  }

  await prisma.activityLog.deleteMany({ where: { userId: user.id } });
  await prisma.workflowRun.deleteMany({ where: { userId: user.id } });
  await prisma.workflow.deleteMany({ where: { userId: user.id } });
  await prisma.memoryPartition.deleteMany({ where: { userId: user.id } });
  await prisma.policyProfile.deleteMany({ where: { userId: user.id } });
  await prisma.scopedCredential.deleteMany({ where: { userId: user.id } });

  const workflow = await prisma.workflow.create({
    data: {
      userId: user.id,
      name: "Job Search Automation",
      goal: "Find high-fit AI platform roles, research each company, tailor the resume, and draft outreach for approval.",
      status: "active",
      weeklyBudgetCents: 500,
      maxRunBudgetCents: 150,
      approvalMode: "approval_gated"
    }
  });

  const workflowAgents = [
    ["Job Discovery Agent", "Discover roles", 1, "Autonomous discovery"],
    ["Company Research Agent", "Research targets", 2, "Human-reviewed notes"],
    ["Resume Tailoring Agent", "Tailor resume", 3, "Approval before export"],
    ["Outreach Draft Agent", "Draft outreach", 4, "Draft-only"]
  ];

  for (const [agentName, roleInWorkflow, routeOrder, defaultMode] of workflowAgents) {
    await prisma.workflowAgent.create({
      data: {
        workflowId: workflow.id,
        agentId: agents[agentName].id,
        roleInWorkflow,
        routeOrder,
        defaultMode
      }
    });
  }

  const partitionInputs = [
    ["Global Profile", "global", "medium", "User-level preferences and durable profile facts.", "approval_required", null],
    ["Job Search Memory", "workflow", "medium", "Roles, target companies, search criteria, and job-search preferences.", "workflow_scoped", workflow.id],
    ["Resume Memory", "workflow", "high", "Resume source, approved bullets, and work-history context.", "approval_required", workflow.id],
    ["Research Memory", "workflow", "medium", "Company briefs, recruiter notes, and opportunity research.", "workflow_scoped", workflow.id],
    ["Finance Memory", "domain", "restricted", "Finance preferences and sensitive financial context.", "blocked_by_default", null],
    ["Health Memory", "domain", "restricted", "Health-related context that agents cannot access by default.", "blocked_by_default", null],
    ["Travel Memory", "domain", "high", "Location, itinerary, and travel preference context.", "approval_required", null]
  ];

  const partitions = {};
  for (const [name, type, sensitivityLevel, description, defaultAccessPolicy, workflowId] of partitionInputs) {
    partitions[name] = await prisma.memoryPartition.create({
      data: {
        userId: user.id,
        workflowId,
        name,
        type,
        sensitivityLevel,
        description,
        defaultAccessPolicy
      }
    });
  }

  await prisma.memoryItem.createMany({
    data: [
      {
        partitionId: partitions["Job Search Memory"].id,
        userId: user.id,
        title: "Target role pattern",
        content: "Prioritize AI agent infrastructure, control plane, and platform engineering roles.",
        sourceType: "user",
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "medium",
        metadata: { tags: ["job-search", "preferences"] }
      },
      {
        partitionId: partitions["Resume Memory"].id,
        userId: user.id,
        title: "Approved resume positioning",
        content: "Position around agent platforms, orchestration, safety, and high-trust product systems.",
        sourceType: "workflow",
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "high",
        metadata: { tags: ["resume", "approved"] }
      },
      {
        partitionId: partitions["Research Memory"].id,
        userId: user.id,
        title: "Company research preference",
        content: "Summaries should include product surface, hiring signals, leadership, and recent funding.",
        sourceType: "agent",
        sourceAgentId: agents["Company Research Agent"].id,
        sourceWorkflowId: workflow.id,
        sensitivityLevel: "medium",
        metadata: { tags: ["research"] }
      }
    ]
  });

  const grant = (partitionName, agentName, flags) =>
    prisma.memoryAccessGrant.create({
      data: {
        partitionId: partitions[partitionName].id,
        agentId: agentName ? agents[agentName].id : null,
        workflowId: workflow.id,
        userId: user.id,
        canRead: Boolean(flags.read),
        canWrite: Boolean(flags.write),
        canEdit: Boolean(flags.edit),
        canDelete: Boolean(flags.delete),
        canShare: Boolean(flags.share),
        requiresApproval: Boolean(flags.approval)
      }
    });

  await Promise.all([
    grant("Job Search Memory", "Job Discovery Agent", { read: true, write: true }),
    grant("Job Search Memory", "Resume Tailoring Agent", { read: true, write: true }),
    grant("Job Search Memory", "Company Research Agent", { read: true, write: true }),
    grant("Job Search Memory", "Outreach Draft Agent", { read: true, write: true, approval: true }),
    grant("Resume Memory", "Resume Tailoring Agent", { read: true, write: true, edit: true, approval: true }),
    grant("Research Memory", "Company Research Agent", { read: true, write: true }),
    grant("Research Memory", "Outreach Draft Agent", { read: true }),
    grant("Finance Memory", "Finance Agent", { approval: true }),
    grant("Health Memory", "Health Agent", { approval: true })
  ]);

  await prisma.memoryAccessLog.createMany({
    data: [
      {
        userId: user.id,
        partitionId: partitions["Job Search Memory"].id,
        agentId: agents["Resume Tailoring Agent"].id,
        workflowId: workflow.id,
        action: "read",
        decision: "allowed",
        reason: "Resume Tailoring Agent read Job Search Memory within workflow grant."
      },
      {
        userId: user.id,
        partitionId: partitions["Research Memory"].id,
        agentId: agents["Outreach Draft Agent"].id,
        workflowId: workflow.id,
        action: "write",
        decision: "allowed",
        reason: "Outreach Draft Agent wrote outreach history as draft-only context."
      },
      {
        userId: user.id,
        partitionId: partitions["Health Memory"].id,
        agentId: agents["Shopping Agent"].id,
        action: "read",
        decision: "blocked",
        reason: "Shopping Agent attempted to read Health Memory."
      },
      {
        userId: user.id,
        partitionId: partitions["Global Profile"].id,
        agentId: agents["Company Research Agent"].id,
        workflowId: workflow.id,
        action: "request_access",
        decision: "approval_required",
        reason: "Research Agent requested Company Preferences."
      },
      {
        userId: user.id,
        partitionId: partitions["Travel Memory"].id,
        action: "delete",
        decision: "revoked",
        reason: "User revoked Travel Agent access to Location Memory."
      }
    ]
  });

  await prisma.policyProfile.create({
    data: {
      userId: user.id,
      name: "Default high-trust policy",
      description: "Approval-gated policy profile for early AgentDock demos.",
      globalEmailPolicy: "Draft-only; never send without explicit approval.",
      globalPaymentPolicy: "Block purchases and payments by default.",
      globalMemoryPolicy: "Partition memory by workflow, sensitivity, and explicit grant.",
      premiumModelPolicy: "Allowed within workflow budget caps.",
      dataSharingPolicy: "Block external sharing unless user approves per action."
    }
  });

  await prisma.scopedCredential.createMany({
    data: [
      {
        userId: user.id,
        workflowId: workflow.id,
        agentId: agents["Job Discovery Agent"].id,
        provider: "Search MCP",
        credentialType: "temporary_scope_metadata",
        scopeDescription: "Search public job listings; no account write access.",
        status: "active"
      },
      {
        userId: user.id,
        workflowId: workflow.id,
        agentId: agents["Outreach Draft Agent"].id,
        provider: "Gmail MCP",
        credentialType: "temporary_scope_metadata",
        scopeDescription: "Create drafts only; send action blocked by policy.",
        status: "active"
      }
    ]
  });

  // ---- A completed run so Control + Flows look alive on first load ----
  const now = Date.now();
  const run = await prisma.workflowRun.create({
    data: {
      userId: user.id,
      workflowId: workflow.id,
      status: "completed",
      startedAt: new Date(now - 1000 * 60 * 12),
      completedAt: new Date(now - 1000 * 60 * 8),
      totalCostCents: 64,
      riskLevel: "medium"
    }
  });

  const runEvents = [
    ["Job Discovery Agent", "mcp_tool_use", "Job Discovery Agent searched 12 roles", "Public job search across target companies.", "allowed", "Search MCP", "Job Search Memory", 9],
    ["Company Research Agent", "a2a_handoff", "Company Research Agent summarized 3 companies", "Handed structured briefs to the resume step.", "allowed", "Search MCP", "Research Memory", 18],
    ["Resume Tailoring Agent", "memory_access", "Resume Tailoring Agent read Resume Memory", "Read approved positioning within grant.", "allowed", null, "Resume Memory", 2],
    ["Resume Tailoring Agent", "approval_requested", "Resume draft created and awaiting approval", "Tailored resume draft queued for review.", "approval_required", "Docs MCP", "Resume Memory", 24],
    ["Outreach Draft Agent", "approval_requested", "Outreach Draft Agent created 3 Gmail drafts", "Drafts queued; sending blocked by policy.", "approval_required", "Gmail draft-only MCP", "Research Memory", 11],
    ["Job Discovery Agent", "action_blocked", "Policy engine blocked direct application", "Apply action requires explicit approval.", "blocked", "Policy Engine", "Job Search Memory", 0]
  ];

  for (let i = 0; i < runEvents.length; i++) {
    const [agentName, eventType, title, description, decision, mcpTool, partitionName, costCents] = runEvents[i];
    await prisma.workflowRunEvent.create({
      data: {
        workflowRunId: run.id,
        userId: user.id,
        agentId: agents[agentName] ? agents[agentName].id : null,
        eventType,
        title,
        description,
        decision,
        mcpTool,
        memoryPartitionId: partitionName && partitions[partitionName] ? partitions[partitionName].id : null,
        costCents,
        createdAt: new Date(now - 1000 * 60 * (12 - i))
      }
    });
  }

  await prisma.approvalRequest.create({
    data: {
      userId: user.id,
      workflowRunId: run.id,
      agentId: agents["Outreach Draft Agent"].id,
      title: "Approve 3 Gmail drafts",
      description: "Outreach Draft Agent prepared 3 recruiter messages. Review before anything sends.",
      actionType: "gmail_draft_approval",
      riskLevel: "high",
      status: "pending"
    }
  });

  await prisma.activityLog.createMany({
    data: [
      {
        userId: user.id, workflowId: workflow.id, workflowRunId: run.id,
        eventType: "workflow_completed", title: "Run completed", description: "Job Search Automation finished one supervised run.",
        decision: "allowed", costCents: 64, createdAt: new Date(now - 1000 * 60 * 8)
      },
      {
        userId: user.id, workflowId: workflow.id, workflowRunId: run.id, agentId: agents["Outreach Draft Agent"].id,
        eventType: "approval_requested", title: "Approval requested: Gmail drafts", description: "3 drafts queued for review.",
        decision: "approval_required", costCents: 11, createdAt: new Date(now - 1000 * 60 * 9)
      },
      {
        userId: user.id, workflowId: workflow.id,
        eventType: "orchestration", title: "Flow planned", description: "AgentDock planned a flow from a goal.",
        decision: "info", costCents: 3, metadata: { source: "orchestrator_plan", provider: "anthropic", model: "claude-sonnet-4-6" },
        createdAt: new Date(now - 1000 * 60 * 20)
      }
    ]
  });

  console.log("Seeded AgentDock mock database.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
