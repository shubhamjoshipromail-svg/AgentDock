const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

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

  const agentInputs = [
    ["Job Discovery Agent", "Discovery", "OpenAI", 96, 9, 91, true, "Finds matching AI infrastructure roles and ranks fit."],
    ["Resume Tailoring Agent", "Documents", "OpenAI", 89, 24, 78, true, "Tailors resume drafts with approval gates."],
    ["Company Research Agent", "Research", "Claude", 92, 18, 84, true, "Builds company briefs and hiring signal summaries."],
    ["Outreach Draft Agent", "Communications", "Gemini", 94, 11, 88, true, "Drafts recruiter outreach without sending."],
    ["Shopping Agent", "Commerce", "Open-source", 81, 7, 82, false, "Compares products and prices with strict memory isolation."],
    ["Finance Agent", "Finance", "Claude", 86, 16, 80, true, "Summarizes finance tasks with restricted memory defaults."],
    ["Health Agent", "Health", "OpenAI", 88, 20, 76, true, "Handles health notes with restricted memory defaults."]
  ];

  const agents = {};
  for (const [name, category, provider, trustScore, costPerTask, tokenEfficiency, verified, description] of agentInputs) {
    agents[name] = await prisma.agent.upsert({
      where: { name },
      update: {
        category,
        provider,
        trustScore,
        costPerTask,
        tokenEfficiency,
        verified,
        description
      },
      create: {
        name,
        category,
        provider,
        trustScore,
        costPerTask,
        tokenEfficiency,
        verified,
        description
      }
    });
  }

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
