import type { McpDefaultPermission, McpRiskLevel, McpVerificationStatus } from "@prisma/client";

// Normalized internal shape — same whether source is official registry or curated.
export type NormalizedMcpServer = {
  name: string;
  displayName: string;
  description: string;
  registrySource: string;
  registryId: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  packageName?: string;
  packageRegistry?: string;
  packageInfo?: unknown;
  version?: string;
  category?: string;
  installCommand?: string;
  verificationStatus: McpVerificationStatus;
  riskLevel: McpRiskLevel;
  recommendedPermission: McpDefaultPermission;
  registryRaw?: unknown;
  tools: {
    name: string;
    description: string;
    riskLevel: McpRiskLevel;
  }[];
};
