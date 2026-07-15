import { NextResponse } from "next/server";

import type { Prisma } from "@prisma/client";

import { getCurrentUser } from "../../../lib/auth-user";
import { agentDefaultsByName } from "../../../lib/catalog/agent-defaults";
import { defaultPermissionForRisk, grantTemplateForPermission } from "../../../lib/mcp-catalog";
import { prisma } from "../../../lib/prisma";
import { parseJsonBody } from "../../../lib/validation/parse";
import { createFlowSchema, type CreateFlowAgentInput, type CreateFlowInput } from "../../../lib/validation/schemas";

type WorkflowAgentInput = CreateFlowAgentInput;
type CreateWorkflowInput = CreateFlowInput;

const workflowInclude = {
  workflowAgents: {
    orderBy: { routeOrder: "asc" },
    include: { agent: true }
  },
  workflowMcps: {
    include: {
      mcpServer: true
    },
    orderBy: { createdAt: "desc" }
  },
  mcpAccessGrants: {
    include: {
      mcpServer: true,
      agent: true
    },
    orderBy: { createdAt: "desc" }
  },
  // Memory partitions currently scoped to this flow — so the Builder can hydrate
  // the canvas from persisted state (Chunk 8 flow-truth) rather than a layout blob.
  memoryPartitions: {
    select: { id: true, name: true, sensitivityLevel: true },
    orderBy: { name: "asc" }
  }
} as const;

// TODO: split catalog vs install — agent rows are user-scoped for now; the
// Store should eventually read from a global catalog with per-user installs.
async function resolveWorkflowAgents(userId: string, agentInputs: WorkflowAgentInput[]) {
  if (agentInputs.length === 0) {
    return { workflowAgents: [], skippedAgents: [] };
  }

  const agentNames = agentInputs
    .map((agent) => agent.agentName ?? agent.name)
    .filter((name): name is string => Boolean(name));
  const agentIds = agentInputs
    .map((agent) => agent.agentId)
    .filter((id): id is string => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    .filter((id): id is string => Boolean(id));

  let matchedAgents = await prisma.agent.findMany({
    where: {
      userId,
      OR: [
        ...(agentNames.length ? [{ name: { in: agentNames } }] : []),
        ...(agentIds.length ? [{ id: { in: agentIds } }] : [])
      ]
    }
  });

  // Create any agent the user references that doesn't already exist for them.
  // Known catalog names use their rich defaults; arbitrary user-defined agents
  // get sane placeholder metadata so the built flow persists honestly.
  const missingAgentNames = agentNames.filter((name) => !matchedAgents.some((agent) => agent.name === name));

  for (const name of missingAgentNames) {
    const catalog = agentDefaultsByName[name];
    const defaults = catalog
      ? (({ name: _ignored, ...rest }) => rest)(catalog)
      : {
          category: "Custom",
          provider: "Custom",
          verified: false,
          description: `${name} (user-defined agent)`
        };
    const agent = await prisma.agent.upsert({
      where: { userId_name: { userId, name } },
      update: defaults,
      create: { userId, name, ...defaults }
    });
    matchedAgents = [...matchedAgents, agent];
  }

  const agentByName = new Map(matchedAgents.map((agent) => [agent.name, agent]));
  const agentById = new Map(matchedAgents.map((agent) => [agent.id, agent]));

  return {
    workflowAgents: agentInputs.flatMap((input) => {
      const agent = (input.agentId ? agentById.get(input.agentId) : null) ?? agentByName.get(input.agentName ?? input.name ?? "");

      if (!agent) {
        return [];
      }

      return {
        agentId: agent.id,
        roleInWorkflow: input.roleInWorkflow,
        routeOrder: input.routeOrder,
        defaultMode: input.defaultMode
      };
    }),
    skippedAgents: agentInputs
      .filter((input) => {
        const agent = (input.agentId ? agentById.get(input.agentId) : null) ?? agentByName.get(input.agentName ?? input.name ?? "");
        return !agent;
      })
      .map((input) => input.agentName ?? input.name ?? input.agentId ?? "Unknown agent")
  };
}

// Resolve tool attachments to workflowMcp rows + per-tool access grants. Unknown
// mcpServerIds are skipped (reported back) rather than failing the whole save.
async function resolveWorkflowTools(workflowId: string, userId: string, tools: CreateWorkflowInput["tools"], tx: Prisma.TransactionClient, sendingEnabled: boolean) {
  const skippedTools: string[] = [];
  // External-send tools skipped because the user has not enabled real sending.
  // Surfaced distinctly so the UI can point the user at the enable action rather
  // than showing a generic "unresolved reference".
  const sendingBlockedTools: string[] = [];

  // Only reconcile when the payload explicitly carries a tool set. Canvas saves
  // omit `tools` entirely — tools attach through the dedicated
  // /api/workflows/[workflowId]/mcps endpoint — so an omitted payload must NOT
  // wipe separately-attached tools. An explicit [] DOES reconcile to "no tools".
  if (tools === undefined) return { skippedTools, sendingBlockedTools };

  // The set of servers actually authored on the canvas (resolved to a real
  // server). Anything not in here is stale and must be removed so the executed
  // set equals the authored set.
  const savedServerIds: string[] = [];

  for (const tool of tools) {
    const mcpServer = await tx.mcpServer.findUnique({ where: { id: tool.mcpServerId } });

    if (!mcpServer) {
      skippedTools.push(tool.mcpServerId);
      continue;
    }

    // Draft-only default: never create a grant for an external-send tool when the
    // user has not enabled real sending. Skipping the grant is the authoritative
    // enforcement (deny-by-default at the runtime gate). Drafting tools are
    // unaffected. Note: a draft-only user has no pre-existing send grant to
    // disturb — existing senders are grandfathered to sendingEnabled=true.
    if (mcpServer.isExternalSend && !sendingEnabled) {
      sendingBlockedTools.push(mcpServer.displayName ?? mcpServer.name);
      continue;
    }

    savedServerIds.push(mcpServer.id);

    const permission = tool.defaultPermission ?? defaultPermissionForRisk(mcpServer.riskLevel);
    const grantTemplate = grantTemplateForPermission(permission, mcpServer.riskLevel);

    await tx.workflowMcp.upsert({
      where: { workflowId_mcpServerId: { workflowId, mcpServerId: mcpServer.id } },
      update: { purpose: tool.purpose, defaultPermission: permission },
      create: { workflowId, mcpServerId: mcpServer.id, purpose: tool.purpose, defaultPermission: permission }
    });

    // One grant per (user, workflow, server) — keyed on the Chunk 8 unique
    // constraint, so re-saves update in place instead of accumulating dupes.
    await tx.mcpAccessGrant.upsert({
      where: { userId_workflowId_mcpServerId: { userId, workflowId, mcpServerId: mcpServer.id } },
      update: { ...grantTemplate, allowedActions: grantTemplate.allowedActions, blockedActions: grantTemplate.blockedActions },
      create: {
        userId,
        workflowId,
        mcpServerId: mcpServer.id,
        ...grantTemplate,
        allowedActions: grantTemplate.allowedActions,
        blockedActions: grantTemplate.blockedActions
      }
    });
  }

  // Reconcile removals: drop the workflow's tool attachments and their access
  // grants for any server no longer on the canvas. Deleting a stale grant on a
  // save is stricter (deny-by-default), never looser. An empty canvas removes
  // every tool + grant for this flow (handled explicitly rather than relying on
  // `notIn: []` semantics).
  const staleServerFilter = savedServerIds.length ? { mcpServerId: { notIn: savedServerIds } } : {};
  await tx.workflowMcp.deleteMany({ where: { workflowId, ...staleServerFilter } });
  await tx.mcpAccessGrant.deleteMany({ where: { userId, workflowId, ...staleServerFilter } });

  return { skippedTools, sendingBlockedTools };
}

// Memory attachments scope an existing user partition to this flow by name.
async function attachWorkflowMemory(workflowId: string, userId: string, memory: CreateWorkflowInput["memory"], tx: Prisma.TransactionClient) {
  const skippedMemory: string[] = [];

  // As with tools: only reconcile when the payload explicitly carries a memory
  // set. An omitted payload leaves existing scoping untouched; an explicit []
  // un-scopes everything previously attached to this flow.
  if (memory === undefined) return { skippedMemory };

  const scopedNames: string[] = [];

  for (const attachment of memory) {
    const partition = await tx.memoryPartition.findFirst({
      where: { userId, name: attachment.partitionName }
    });

    if (!partition) {
      skippedMemory.push(attachment.partitionName);
      continue;
    }

    scopedNames.push(partition.name);

    await tx.memoryPartition.update({
      where: { id: partition.id },
      data: { workflowId }
    });
  }

  // Reconcile removals: un-scope any partition still pointing at this flow whose
  // name is no longer in the authored memory set. This only changes which
  // partitions are scoped — it never alters how grants are enforced at runtime
  // (the Chunk 6 memory firewall is untouched). An empty memory set un-scopes
  // every partition previously attached to this flow.
  const stillScopedFilter = scopedNames.length ? { name: { notIn: scopedNames } } : {};
  await tx.memoryPartition.updateMany({
    where: { userId, workflowId, ...stillScopedFilter },
    data: { workflowId: null }
  });

  return { skippedMemory };
}

async function saveWorkflowForUser(userId: string, body: CreateWorkflowInput, sendingEnabled: boolean) {
  const { workflowAgents, skippedAgents } = await resolveWorkflowAgents(userId, body.agents ?? []);
  const existingWorkflow = await prisma.workflow.findFirst({
    where: {
      userId,
      name: body.name
    }
  });

  const layout = (body.layout ?? undefined) as Prisma.InputJsonValue | undefined;

  const result = await prisma.$transaction(async (tx) => {
    const saved = existingWorkflow
      ? await (async () => {
          await tx.workflowAgent.deleteMany({ where: { workflowId: existingWorkflow.id } });
          return tx.workflow.update({
            where: { id: existingWorkflow.id },
            data: {
              goal: body.goal,
              status: "active",
              weeklyBudgetCents: body.weeklyBudgetCents,
              maxRunBudgetCents: body.maxRunBudgetCents,
              approvalMode: body.approvalMode,
              ...(layout !== undefined ? { layout } : {}),
              workflowAgents: { create: workflowAgents }
            }
          });
        })()
      : await tx.workflow.create({
          data: {
            userId,
            name: body.name,
            goal: body.goal,
            status: "active",
            weeklyBudgetCents: body.weeklyBudgetCents,
            maxRunBudgetCents: body.maxRunBudgetCents,
            approvalMode: body.approvalMode,
            ...(layout !== undefined ? { layout } : {}),
            workflowAgents: { create: workflowAgents }
          }
        });

    const { skippedTools, sendingBlockedTools } = await resolveWorkflowTools(saved.id, userId, body.tools, tx, sendingEnabled);
    const { skippedMemory } = await attachWorkflowMemory(saved.id, userId, body.memory, tx);

    const workflow = await tx.workflow.findUniqueOrThrow({
      where: { id: saved.id },
      include: workflowInclude
    });

    return { workflow, skippedTools, skippedMemory, sendingBlockedTools };
  });

  return { workflow: result.workflow, skippedAgents, skippedTools: result.skippedTools, skippedMemory: result.skippedMemory, sendingBlockedTools: result.sendingBlockedTools };
}

async function findWorkflowsForUser(userId: string) {
  return prisma.workflow.findMany({
    where: { userId, status: { not: "archived" } },
    include: workflowInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to load saved workflows." }, { status: 401 });
  }

  // Pure read: starter data creation lives in POST /api/bootstrap.
  const workflows = await findWorkflowsForUser(user.id);

  return NextResponse.json({ workflows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized. Sign in with Google to save workflows." }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, createFlowSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.data;

  // SAVE INTEGRITY (Chunk 19): a flow with zero resolved agents cannot be saved
  // — it could never run ("Flow has no agents to run" shells). Refused up front
  // with the resolution detail, before anything persists.
  const resolvedAgents = await resolveWorkflowAgents(user.id, body.agents ?? []);
  if (resolvedAgents.workflowAgents.length === 0) {
    return NextResponse.json(
      {
        message: "This flow has no agents, so it could never run. Add at least one agent (or re-plan the goal) before saving.",
        skippedAgents: resolvedAgents.skippedAgents
      },
      { status: 400 }
    );
  }

  const { workflow, skippedAgents, skippedTools, skippedMemory, sendingBlockedTools } = await saveWorkflowForUser(user.id, body, user.sendingEnabled);

  // Silently-partial saves are errors the UI must show, not footnotes.
  const skippedTotal = skippedAgents.length + skippedTools.length + skippedMemory.length;
  const sendingMessage = sendingBlockedTools.length > 0
    ? `Real sending is off, so ${sendingBlockedTools.length} send tool${sendingBlockedTools.length > 1 ? "s were" : " was"} not granted (${sendingBlockedTools.join(", ")}). Drafting still works and stays approval-gated; enable real sending in Profile to grant sends.`
    : undefined;
  const partialMessage = skippedTotal > 0
    ? `Saved with ${skippedTotal} unresolved reference${skippedTotal > 1 ? "s" : ""} skipped — review before running.`
    : undefined;
  const message = [partialMessage, sendingMessage].filter(Boolean).join(" ") || undefined;

  return NextResponse.json(
    { workflow, skippedAgents, skippedTools, skippedMemory, sendingBlockedTools, ...(message ? { message } : {}) },
    { status: 201 }
  );
}
