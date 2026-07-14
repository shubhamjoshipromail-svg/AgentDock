import { prisma } from "../prisma";
import type { CatalogSnapshot, CatalogSnapshotTool } from "./schema";

// The full tool catalog (~500 servers) cannot be dumped into a prompt. Strategy:
//   - all VERIFIED servers (the curated tier, ~6) always included, with tool names
//   - up to N external servers ranked by simple keyword overlap on the goal
//   - the user's agents + memory partitions in full (they are small)
export const SNAPSHOT_EXTERNAL_LIMIT = 30;

// No per-user policy table exists yet; the model is shown the safe defaults.
export const DEFAULT_POLICY = {
  weeklyBudgetCents: 500,
  maxRunBudgetCents: 150,
  approvalMode: "approval_gated"
} as const;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "without", "not", "this", "that", "are", "you",
  "your", "from", "into", "out", "any", "all", "can", "will", "use", "using", "via"
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

export function relevanceScore(goalTokens: Set<string>, text: string): number {
  let score = 0;
  for (const token of Array.from(tokenize(text))) {
    if (goalTokens.has(token)) score += 1;
  }
  return score;
}

export async function buildCatalogSnapshot(userId: string, goal: string, sendingEnabled = true): Promise<CatalogSnapshot> {
  const goalTokens = tokenize(goal);

  const [agents, partitions, verifiedServers, externalServers] = await Promise.all([
    prisma.agent.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.memoryPartition.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.mcpServer.findMany({
      where: { verificationStatus: "verified" },
      include: { tools: { orderBy: { name: "asc" } } },
      orderBy: { displayName: "asc" }
    }),
    prisma.mcpServer.findMany({
      where: { NOT: { verificationStatus: "verified" } },
      orderBy: { displayName: "asc" }
    })
  ]);

  // Canonical Chunk-16 execution identity: the ONE key that runs plan → resolve
  // → save → grant → execute. null = metadata-only catalog row (not attachable).
  const canonicalKey = (server: { mcpServerKey: string | null; mcpToolName: string | null }): string | null =>
    server.mcpServerKey && server.mcpToolName ? `${server.mcpServerKey}:${server.mcpToolName}` : null;

  const verifiedTools: CatalogSnapshotTool[] = verifiedServers.map((server) => ({
    id: server.id,
    key: canonicalKey(server),
    isExternalSend: server.isExternalSend,
    serverName: server.displayName,
    displayName: server.displayName,
    description: server.description,
    riskLevel: server.riskLevel,
    verificationStatus: server.verificationStatus,
    recommendedPermission: server.recommendedPermission,
    toolNames: server.tools.map((tool) => tool.name)
  }));

  // Keyword relevance: keep only servers that share a token with the goal, ranked
  // by overlap, deterministic tie-break by display name, capped at the limit.
  const rankedExternal: CatalogSnapshotTool[] = externalServers
    .map((server) => ({ server, score: relevanceScore(goalTokens, `${server.displayName} ${server.description}`) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.server.displayName.localeCompare(b.server.displayName))
    .slice(0, SNAPSHOT_EXTERNAL_LIMIT)
    .map(({ server }) => ({
      id: server.id,
      key: canonicalKey(server),
      isExternalSend: server.isExternalSend,
      serverName: server.displayName,
      displayName: server.displayName,
      description: server.description,
      riskLevel: server.riskLevel,
      verificationStatus: server.verificationStatus,
      recommendedPermission: server.recommendedPermission,
      toolNames: []
    }));

  // Draft-only default: a user who has not enabled real sending is not shown
  // external-send tools, so the planner drafts instead of proposing a send it
  // could never be granted. Drafting tools remain fully available. (Enforcement
  // is the grant gate; this keeps the plan honest and avoids a proposed-then-
  // dropped send.)
  const offeredTools = [...verifiedTools, ...rankedExternal].filter(
    (tool) => sendingEnabled || !tool.isExternalSend
  );

  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      category: agent.category,
      description: agent.description
    })),
    tools: offeredTools,
    memory: partitions.map((partition) => ({
      id: partition.id,
      partitionName: partition.name,
      domain: partition.type,
      sensitivity: partition.sensitivityLevel
    })),
    policy: { ...DEFAULT_POLICY }
  };
}
