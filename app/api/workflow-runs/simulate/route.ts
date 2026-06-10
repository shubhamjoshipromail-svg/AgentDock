import { NextResponse } from "next/server";
import type { ApprovalActionType, RuntimeDecision, WorkflowRunEventType } from "@prisma/client";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { parseJsonBody } from "../../../../lib/validation/parse";
import { simulateRunSchema } from "../../../../lib/validation/schemas";

type SimulatedEventInput = {
  eventType: WorkflowRunEventType;
  title: string;
  description: string;
  decision: RuntimeDecision;
  agentId?: string;
  mcpTool?: string;
  memoryPartitionId?: string;
  costCents: number;
};

type SimulatedApprovalInput = {
  title: string;
  description: string;
  actionType: ApprovalActionType;
  riskLevel: string;
  agentId?: string;
};

const workflowRunInclude = {
  workflow: true,
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      agent: true,
      memoryPartition: true
    }
  },
  approvalRequests: {
    orderBy: { requestedAt: "desc" },
    include: { agent: true }
  }
} as const;

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to run database-backed workflow simulations." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, simulateRunSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

  try {
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: body.workflowId,
        userId: user.id
      },
      include: {
        workflowAgents: {
          include: { agent: true }
        },
        workflowMcps: {
          include: { mcpServer: true }
        },
        mcpAccessGrants: {
          include: { mcpServer: true }
        }
      }
    });

    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found for the signed-in user." }, { status: 404 });
    }

    const agents = new Map(workflow.workflowAgents.map((workflowAgent) => [workflowAgent.agent.name, workflowAgent.agent]));
    const partitions = await prisma.memoryPartition.findMany({
      where: {
        userId: user.id,
        name: { in: ["Job Search Memory", "Resume Memory", "Research Memory", "Finance Memory"] }
      }
    });
    const partitionByName = new Map(partitions.map((partition) => [partition.name, partition]));
    const attachedMcpNames = new Set(workflow.workflowMcps.map((workflowMcp) => workflowMcp.mcpServer.displayName));
    const attachedMcpEvents: SimulatedEventInput[] = [
      ...(attachedMcpNames.has("Search MCP")
        ? [{
            eventType: "mcp_tool_use" as const,
            title: "Job Discovery Agent used Search MCP metadata route",
            description: "Simulation used the workflow-scoped Search MCP permission metadata. No MCP server or tool was executed.",
            decision: "info" as const,
            agentId: agents.get("Job Discovery Agent")?.id,
            mcpTool: "Search MCP",
            memoryPartitionId: partitionByName.get("Job Search Memory")?.id,
            costCents: 0
          }]
        : []),
      ...(attachedMcpNames.has("Gmail Draft MCP")
        ? [{
            eventType: "approval_requested" as const,
            title: "Outreach Draft Agent requested Gmail Draft MCP access",
            description: "Simulation checked Gmail Draft MCP permission metadata and routed draft access through approval. No Google scope was requested and no MCP tool was called.",
            decision: "approval_required" as const,
            agentId: agents.get("Outreach Draft Agent")?.id,
            mcpTool: "Gmail Draft MCP",
            memoryPartitionId: partitionByName.get("Job Search Memory")?.id,
            costCents: 0
          }]
        : [])
    ];
    const totalCostCents = 73;

    const run = await prisma.$transaction(async (tx) => {
      const workflowRun = await tx.workflowRun.create({
        data: {
          userId: user.id,
          workflowId: workflow.id,
          status: "waiting_for_approval",
          totalCostCents,
          riskLevel: "medium"
        }
      });

      const eventInputs: SimulatedEventInput[] = [
        {
          eventType: "orchestration",
          title: "Orchestration Agent recommended Job Search Automation stack",
          description: "AgentDock selected discovery, research, resume, outreach, memory firewall, credential gateway, and A2UI approval gates.",
          decision: "info",
          costCents: 0
        },
        {
          eventType: "mcp_tool_use",
          title: "Job Discovery Agent searched 12 roles",
          description: "Search MCP returned a ranked list of AI platform and agent infrastructure roles.",
          decision: "allowed",
          agentId: agents.get("Job Discovery Agent")?.id,
          mcpTool: "Search MCP",
          memoryPartitionId: partitionByName.get("Job Search Memory")?.id,
          costCents: 10
        },
        {
          eventType: "a2a_handoff",
          title: "Company Research Agent summarized 3 companies",
          description: "A2A Router handed selected roles to research for company summaries and hiring signal notes.",
          decision: "allowed",
          agentId: agents.get("Company Research Agent")?.id,
          mcpTool: "Search MCP",
          memoryPartitionId: partitionByName.get("Research Memory")?.id,
          costCents: 18
        },
        {
          eventType: "memory_access",
          title: "Resume Tailoring Agent read Resume Memory",
          description: "Memory Firewall allowed workflow-scoped read access to approved resume context.",
          decision: "allowed",
          agentId: agents.get("Resume Tailoring Agent")?.id,
          memoryPartitionId: partitionByName.get("Resume Memory")?.id,
          costCents: 0
        },
        {
          eventType: "approval_requested",
          title: "Resume Tailoring Agent created a draft and requires approval",
          description: "Resume draft is queued for human review before export or sharing.",
          decision: "approval_required",
          agentId: agents.get("Resume Tailoring Agent")?.id,
          memoryPartitionId: partitionByName.get("Resume Memory")?.id,
          costCents: 24
        },
        {
          eventType: "approval_requested",
          title: "Outreach Draft Agent requested Gmail draft access",
          description: "Gmail access remains draft-only and requires approval before any send action.",
          decision: "approval_required",
          agentId: agents.get("Outreach Draft Agent")?.id,
          mcpTool: "Gmail Draft MCP",
          memoryPartitionId: partitionByName.get("Job Search Memory")?.id,
          costCents: 11
        },
        {
          eventType: "action_blocked",
          title: "Outreach Draft Agent attempted to send email",
          description: "The attempted send exceeded draft-only scope and was routed to policy review.",
          decision: "approval_required",
          agentId: agents.get("Outreach Draft Agent")?.id,
          mcpTool: "Gmail Draft MCP",
          memoryPartitionId: partitionByName.get("Job Search Memory")?.id,
          costCents: 0
        },
        {
          eventType: "action_blocked",
          title: "Policy Engine blocked direct email send",
          description: "Email sending is blocked by default for this workflow unless the user explicitly approves it.",
          decision: "blocked",
          agentId: agents.get("Outreach Draft Agent")?.id,
          mcpTool: "Gmail Draft MCP",
          costCents: 0
        },
        {
          eventType: "memory_access",
          title: "Memory Firewall blocked unrelated Finance Memory access",
          description: "The workflow requested job-search context only; Finance Memory stayed isolated.",
          decision: "blocked",
          agentId: agents.get("Outreach Draft Agent")?.id,
          memoryPartitionId: partitionByName.get("Finance Memory")?.id,
          costCents: 0
        },
        {
          eventType: "credential_minted",
          title: "Credential Gateway minted temporary scoped credentials",
          description: "Temporary model/tool credentials were created for this simulated run; no raw provider keys were exposed.",
          decision: "allowed",
          costCents: 10
        }
      ];
      eventInputs.push(...attachedMcpEvents);

      await tx.workflowRunEvent.createMany({
        data: eventInputs.map((event) => ({
          workflowRunId: workflowRun.id,
          userId: user.id,
          agentId: event.agentId,
          eventType: event.eventType,
          title: event.title,
          description: event.description,
          decision: event.decision,
          mcpTool: event.mcpTool,
          memoryPartitionId: event.memoryPartitionId,
          costCents: event.costCents,
          metadata: {
            source: "mock_simulation",
            workflowName: workflow.name
          }
        }))
      });

      const approvalInputs: SimulatedApprovalInput[] = [
        {
          title: "Review resume draft",
          description: "Resume Tailoring Agent produced a tailored draft that needs human approval before export.",
          actionType: "resume_draft_review",
          riskLevel: "medium",
          agentId: agents.get("Resume Tailoring Agent")?.id
        },
        {
          title: "Approve 3 Gmail drafts",
          description: "Outreach Draft Agent created Gmail drafts but cannot send them without approval.",
          actionType: "gmail_draft_approval",
          riskLevel: "medium",
          agentId: agents.get("Outreach Draft Agent")?.id
        },
        {
          title: "Company Preferences access request",
          description: "Company Research Agent requested access to preference context for ranking companies.",
          actionType: "memory_access_request",
          riskLevel: "low",
          agentId: agents.get("Company Research Agent")?.id
        }
      ];

      await tx.approvalRequest.createMany({
        data: approvalInputs.map((approval) => ({
          userId: user.id,
          workflowRunId: workflowRun.id,
          agentId: approval.agentId,
          title: approval.title,
          description: approval.description,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel,
          status: "pending",
          metadata: {
            source: "mock_simulation",
            workflowName: workflow.name
          }
        }))
      });

      await tx.activityLog.createMany({
        data: eventInputs.map((event) => ({
          userId: user.id,
          workflowId: workflow.id,
          workflowRunId: workflowRun.id,
          agentId: event.agentId,
          eventType: event.eventType,
          title: event.title,
          description: event.description,
          decision: event.decision,
          costCents: event.costCents,
          metadata: {
            source: "mock_simulation",
            workflowName: workflow.name,
            mcpTool: event.mcpTool,
            memoryPartitionId: event.memoryPartitionId
          }
        }))
      });

      await tx.activityLog.createMany({
        data: approvalInputs.map((approval) => ({
          userId: user.id,
          workflowId: workflow.id,
          workflowRunId: workflowRun.id,
          agentId: approval.agentId,
          eventType: "approval_requested",
          title: approval.title,
          description: approval.description,
          decision: "approval_required",
          costCents: 0,
          metadata: {
            source: "mock_simulation",
            actionType: approval.actionType,
            workflowName: workflow.name
          }
        }))
      });

      return workflowRun;
    });

    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: run.id },
      include: workflowRunInclude
    });

    return NextResponse.json({ workflowRun }, { status: 201 });
  } catch (error) {
    console.error("Workflow simulation failed", error);
    return NextResponse.json({ message: "Unable to simulate workflow run." }, { status: 500 });
  }
}
