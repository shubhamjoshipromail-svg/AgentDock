import type { McpDefaultPermission, McpRiskLevel } from "@prisma/client";
import type { NormalizedMcpServer } from "./types";

// Deny-by-default curation rules for external (non-curated) registry entries.
// External servers get conservative defaults because AgentDock has not verified them.
// These values are never copied from registry metadata — they are AgentDock's judgment.

// Exported so the orchestrator's clamp step mirrors this judgment instead of
// duplicating it divergently: any non-verified server's permission floor.
export const EXTERNAL_RISK_LEVEL: McpRiskLevel = "medium";
export const EXTERNAL_PERMISSION: McpDefaultPermission = "approval_required";

// Sanitize a registry name like "ac.inference.sh/mcp" into a valid DB slug.
// The registry name is already unique per source, so we use it as-is (namespaced).
function toDbName(registryId: string, registrySource: string): string {
  const prefix = registrySource === "agentdock-curated" ? "" : "reg:";
  return `${prefix}${registryId}`.toLowerCase().slice(0, 200);
}

export type RawRegistryEntry = {
  server: {
    name: string;
    title?: string;
    description?: string;
    version?: string;
    repository?: { url?: string; source?: string };
    packages?: {
      registryType?: string;
      identifier?: string;
      version?: string;
      transport?: unknown;
    }[];
    remotes?: { type?: string; url?: string }[];
  };
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      status?: string;
      isLatest?: boolean;
    };
  };
};

export function normalizeExternal(raw: RawRegistryEntry): NormalizedMcpServer | null {
  const { server, _meta } = raw;

  if (!server?.name) return null;

  const official = _meta?.["io.modelcontextprotocol.registry/official"];
  // Skip non-active entries
  if (official?.status && official.status !== "active") return null;

  const registryId = server.name;
  const pkg = server.packages?.[0];
  const remote = server.remotes?.[0];

  return {
    name: toDbName(registryId, "mcp-official-registry"),
    displayName: server.title ?? registryId,
    description: server.description ?? "",
    registrySource: "mcp-official-registry",
    registryId,
    repositoryUrl: server.repository?.url,
    homepageUrl: remote?.url,
    packageName: pkg?.identifier,
    packageRegistry: pkg?.registryType,
    packageInfo: server.packages ?? undefined,
    version: pkg?.version ?? server.version,
    verificationStatus: "unverified",
    riskLevel: EXTERNAL_RISK_LEVEL,
    recommendedPermission: EXTERNAL_PERMISSION,
    registryRaw: raw,
    tools: []
  };
}

// Curated entries override external ones when the same package/repo is found.
// Returns true if curated entry should win over the external entry.
export function curatedWins(
  curated: NormalizedMcpServer,
  external: NormalizedMcpServer
): boolean {
  if (curated.packageName && curated.packageName === external.packageName &&
      curated.packageRegistry === external.packageRegistry) {
    return true;
  }
  if (curated.repositoryUrl && curated.repositoryUrl === external.repositoryUrl) {
    return true;
  }
  return false;
}

export function normalizedRiskToPermission(risk: McpRiskLevel): McpDefaultPermission {
  if (risk === "low") return "read_only";
  if (risk === "high") return "draft_only";
  if (risk === "restricted") return "blocked";
  return "approval_required";
}
