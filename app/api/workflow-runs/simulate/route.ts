import { NextResponse } from "next/server";
import type { ApprovalActionType, McpAccessGrant, RuntimeDecision, WorkflowRunEventType } from "@prisma/client";

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

// A grant's effective decision is derived purely from its permission flags:
// no allowed capability => blocked; approval gate => approval_required; else allowed.
function grantDecision(grant: Pick<McpAccessGrant, "canRead" | "canWrite" | "canExecute" | "canDelete" | "requiresApproval">): RuntimeDecision {
  const hasAnyCapability = grant.canRead || grant.canWrite || grant.canExecute || grant.canDelete;

  if (!hasAnyCapability) {
    return "blocked";
  }

  if (grant.requiresApproval) {
    return "approval_required";
  }

  return "allowed";
}

const eventTypeForDecision: Record<RuntimeDecision, WorkflowRunEventType> = {
  allowed: "mcp_tool_use",
  approval_required: "approval_requested",
  blocked: "action_blocked",
  approved: "mcp_tool_use",
  denied: "action_blocked",
  info: "mcp_tool_use"
};

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
          orderBy: { routeOrder: "asc" },
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

    const grantByServerId = new Map(workflow.mcpAccessGrants.map((grant) => [grant.mcpServerId, grant]));

    const eventInputs: SimulatedEventInput[] = [];
    const approvalInputs: SimulatedApprovalInput[] = [];
    let totalCostCents = 0;

    // Deterministic orchestration header event for any flow.
    eventInputs.push({
      eventType: "orchestration",
      title: `Orchestration Agent planned ${workflow.name}`,
      description: `AgentDock walked ${workflow.workflowAgents.length} agent(s) and ${workflow.workflowMcps.length} attached tool(s) in route order. No agent or tool was executed.`,
      decision: "info",
      costCents: 0
    });

    // One event per agent, in route order, with the agent's deterministic per-task cost.
    for (const workflowAgent of workflow.workflowAgents) {
      const cost = workflowAgent.agent.costPerTask;
      totalCostCents += cost;
      eventInputs.push({
        eventType: "a2a_handoff",
        title: `${workflowAgent.agent.name} ran step ${workflowAgent.routeOrder} (${workflowAgent.roleInWorkflow})`,
        description: `Simulated ${workflowAgent.agent.name} in mode "${workflowAgent.defaultMode}". Deterministic mock cost only; no model call was made.`,
        decision: "allowed",
        agentId: workflowAgent.agentId,
        costCents: cost
      });
    }

    // One event per attached tool grant; decision derived from the grant's permission.
    for (const workflowMcp of workflow.workflowMcps) {
      const grant = grantByServerId.get(workflowMcp.mcpServerId);
      const decision: RuntimeDecision = grant ? grantDecision(grant) : "blocked";
      const cost = decision === "allowed" ? 5 : 0;
      totalCostCents += cost;

      eventInputs.push({
        eventType: eventTypeForDecision[decision],
        title: `${workflowMcp.mcpServer.displayName} access ${decision.replaceAll("_", " ")}`,
        description: `Tool grant for ${workflowMcp.mcpServer.displayName} evaluated as ${decision.replaceAll("_", " ")} from saved permission metadata. No tool was executed.`,
        decision,
        mcpTool: workflowMcp.mcpServer.displayName,
        costCents: cost
      });

      if (decision === "approval_required") {
        approvalInputs.push({
          title: `Approve ${workflowMcp.mcpServer.displayName} access`,
          description: `${workflowMcp.mcpServer.displayName} requires approval before use in ${workflow.name}.`,
          actionType: "tool_scope_change",
          riskLevel: workflowMcp.mcpServer.riskLevel
        });
      }
    }

    const run = await prisma.$transaction(async (tx) => {
      const workflowRun = await tx.workflowRun.create({
        data: {
          userId: user.id,
          workflowId: workflow.id,
          status: approvalInputs.length ? "waiting_for_approval" : "completed",
          completedAt: approvalInputs.length ? null : new Date(),
          totalCostCents,
          riskLevel: "medium"
        }
      });

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
          costCents: event.costCents,
          metadata: {
            source: "mock_simulation",
            workflowName: workflow.name
          }
        }))
      });

      if (approvalInputs.length) {
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
      }

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
            mcpTool: event.mcpTool
          }
        }))
      });

      if (approvalInputs.length) {
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
      }

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
