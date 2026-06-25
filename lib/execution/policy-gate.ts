import type { McpDefaultPermission, McpRiskLevel, McpVerificationStatus } from "../types";

// ============================================================================
// THE DETERMINISTIC PRE-ACTION POLICY GATE — the most important code in the
// product. Pure, total, server-side, zero side effects, zero model calls.
//
// Authorization is decided HERE, before any tool runs — never by trusting the
// model to self-police, never post-hoc. Deny-by-default: anything not provably
// allowed is blocked. Privilege lives in this function and the grants it reads,
// NEVER in the prompt — so injection in a goal, a tool output, or memory cannot
// escalate scope.
// ============================================================================

export type ActionKind = "read" | "write" | "send" | "delete" | "execute";
export type GateDecision = "allowed" | "approval_required" | "blocked";

export type GateInput = {
  // Is this tool server on the agent's allow-list at all (a grant exists)?
  inAllowList: boolean;
  // The effective grant for this agent + server, or null if none.
  grant: {
    permission: McpDefaultPermission; // read_only | draft_only | approval_required | blocked
    revokedAt: Date | null;
  } | null;
  server: {
    verificationStatus: McpVerificationStatus;
    riskLevel: McpRiskLevel;
    recommendedPermission: McpDefaultPermission;
  };
  action: {
    kind: ActionKind;
    // A tool that writes/sends OUTSIDE (email send, post, payment). Read-only
    // web search is never an external send.
    isExternalSend: boolean;
  };
  step: {
    // This step has already ingested untrusted external content (e.g. search results).
    ingestedUntrusted: boolean;
    // This step has access to sensitive (restricted) memory.
    hasSensitiveMemory: boolean;
  };
};

export type GateResult = { decision: GateDecision; reason: string };

const block = (reason: string): GateResult => ({ decision: "blocked", reason });
const approve = (reason: string): GateResult => ({ decision: "approval_required", reason });
const allow = (reason: string): GateResult => ({ decision: "allowed", reason });

// Maps the DB grant booleans to an effective permission. Strictest wins; the
// run engine calls this then passes the result into authorizeToolCall.
export function effectiveGrantPermission(grant: {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canDelete: boolean;
  requiresApproval: boolean;
}): McpDefaultPermission {
  if (!grant.canRead && !grant.canWrite && !grant.canExecute && !grant.canDelete) return "blocked";
  if (grant.requiresApproval) return "approval_required";
  if (grant.canWrite || grant.canExecute || grant.canDelete) return "draft_only";
  if (grant.canRead) return "read_only";
  return "blocked";
}

export function authorizeToolCall(input: GateInput): GateResult {
  const { inAllowList, grant, server, action, step } = input;

  // 1. Deny-by-default: no allow-list entry / no grant.
  //    But low-risk, read-only tools (like web search) surface as an approval
  //    request so the user can one-click grant them at the moment of consequence —
  //    rather than silently blocking. High-risk or write tools still hard-block.
  if (!inAllowList || !grant) {
    if (action.kind === "read" && !action.isExternalSend && server.riskLevel !== "restricted" && server.riskLevel !== "high") {
      return approve("tool is not yet granted — approve to allow this read-only action once");
    }
    return block("tool is not on the agent's allow-list");
  }

  // 2. Revoked grant (kill switch / expiry) → blocked.
  if (grant.revokedAt) {
    return block("grant has been revoked");
  }

  // 3. Restricted-risk server → always blocked.
  if (server.riskLevel === "restricted") {
    return block("restricted-risk server is blocked");
  }

  // 4. Explicit block on grant or server recommendation → blocked.
  if (grant.permission === "blocked" || server.recommendedPermission === "blocked") {
    return block("permission is blocked for this server");
  }

  const isWrite = action.kind !== "read";

  // 5. Base decision from the grant's effective permission.
  let result: GateResult;
  switch (grant.permission) {
    case "read_only":
      result = isWrite
        ? block("read_only grant cannot perform a write/send/delete")
        : allow("read within read_only grant");
      break;
    case "draft_only":
      result = isWrite
        ? approve("draft_only grant requires approval for a write/send")
        : allow("read within draft_only grant");
      break;
    case "approval_required":
    default:
      result = approve("grant requires approval");
      break;
  }

  if (result.decision === "blocked") return result;

  // 6. Verification ceiling: any non-verified server can never be "allowed".
  if (server.verificationStatus !== "verified" && result.decision === "allowed") {
    result = approve("unverified server requires at least approval");
  }

  // 7. Lethal-trifecta guard: untrusted ingest + sensitive memory + external
  //    send must force approval at minimum (structurally blocks the dangerous
  //    private-data + untrusted-content + external-send combination).
  if (
    action.isExternalSend &&
    step.ingestedUntrusted &&
    step.hasSensitiveMemory &&
    result.decision === "allowed"
  ) {
    result = approve("lethal trifecta: untrusted content + sensitive memory + external send requires approval");
  }

  return result;
}
