import { describe, expect, it } from "vitest";

import { authorizeToolCall, effectiveGrantPermission, type GateInput } from "../lib/execution/policy-gate";
import type { McpDefaultPermission } from "../lib/types";

// A safe, verified, allow-listed, read_only baseline. Each test overrides only
// what it asserts on — every branch and the adversarial combinations are covered.
function base(overrides: Partial<GateInput> = {}): GateInput {
  return {
    inAllowList: true,
    grant: { permission: "read_only", revokedAt: null },
    server: { verificationStatus: "verified", riskLevel: "low", recommendedPermission: "read_only" },
    action: { kind: "read", isExternalSend: false },
    step: { ingestedUntrusted: false, hasSensitiveMemory: false },
    ...overrides
  };
}

describe("authorizeToolCall — deterministic policy gate", () => {
  it("deny-by-default: tool not on the allow-list → blocked", () => {
    expect(authorizeToolCall(base({ inAllowList: false })).decision).toBe("blocked");
    expect(authorizeToolCall(base({ grant: null })).decision).toBe("blocked");
  });

  it("revoked grant → blocked (kill switch)", () => {
    expect(authorizeToolCall(base({ grant: { permission: "read_only", revokedAt: new Date() } })).decision).toBe("blocked");
  });

  it("restricted-risk server → blocked", () => {
    expect(authorizeToolCall(base({ server: { verificationStatus: "verified", riskLevel: "restricted", recommendedPermission: "read_only" } })).decision).toBe("blocked");
  });

  it("explicit blocked permission (grant or server) → blocked", () => {
    expect(authorizeToolCall(base({ grant: { permission: "blocked", revokedAt: null } })).decision).toBe("blocked");
    expect(authorizeToolCall(base({ server: { verificationStatus: "verified", riskLevel: "low", recommendedPermission: "blocked" } })).decision).toBe("blocked");
  });

  it("read_only + read → allowed; read_only + write/send/delete → blocked", () => {
    expect(authorizeToolCall(base()).decision).toBe("allowed");
    for (const kind of ["write", "send", "delete", "execute"] as const) {
      expect(authorizeToolCall(base({ action: { kind, isExternalSend: false } })).decision).toBe("blocked");
    }
  });

  it("draft_only + read → allowed; draft_only + write/send → approval_required", () => {
    expect(authorizeToolCall(base({ grant: { permission: "draft_only", revokedAt: null } })).decision).toBe("allowed");
    expect(authorizeToolCall(base({ grant: { permission: "draft_only", revokedAt: null }, action: { kind: "send", isExternalSend: true } })).decision).toBe("approval_required");
  });

  it("approval_required grant → approval_required for read and write", () => {
    expect(authorizeToolCall(base({ grant: { permission: "approval_required", revokedAt: null } })).decision).toBe("approval_required");
    expect(authorizeToolCall(base({ grant: { permission: "approval_required", revokedAt: null }, action: { kind: "write", isExternalSend: false } })).decision).toBe("approval_required");
  });

  it("verification ceiling: non-verified server can never be allowed", () => {
    for (const verificationStatus of ["community", "unverified"] as const) {
      const res = authorizeToolCall(base({ server: { verificationStatus, riskLevel: "low", recommendedPermission: "read_only" } }));
      expect(res.decision).toBe("approval_required");
    }
  });

  it("lethal trifecta: untrusted ingest + sensitive memory + external send is never allowed", () => {
    // Realistic send under draft_only → approval_required (forced).
    const send = authorizeToolCall(base({
      grant: { permission: "draft_only", revokedAt: null },
      action: { kind: "send", isExternalSend: true },
      step: { ingestedUntrusted: true, hasSensitiveMemory: true }
    }));
    expect(send.decision).toBe("approval_required");

    // The guard upgrades an otherwise-allowed external action to approval.
    const upgraded = authorizeToolCall(base({
      action: { kind: "read", isExternalSend: true },
      step: { ingestedUntrusted: true, hasSensitiveMemory: true }
    }));
    expect(upgraded.decision).toBe("approval_required");
    expect(upgraded.reason).toContain("trifecta");
  });

  it("ADVERSARIAL: injection-style action names cannot bypass the gate", () => {
    // A model that emits a write disguised under read_only is still blocked.
    const res = authorizeToolCall(base({ action: { kind: "delete", isExternalSend: true } }));
    expect(res.decision).toBe("blocked");
    // A non-allow-listed tool with an "approved" grant claim is still blocked.
    expect(authorizeToolCall(base({ inAllowList: false, grant: { permission: "read_only", revokedAt: null } })).decision).toBe("blocked");
  });

  it("invariant: an unverified / non-allow-listed / over-scoped request is NEVER allowed", () => {
    const cases: GateInput[] = [
      base({ inAllowList: false }),
      base({ grant: null }),
      base({ grant: { permission: "approval_required", revokedAt: null } }),
      base({ server: { verificationStatus: "unverified", riskLevel: "low", recommendedPermission: "read_only" } }),
      base({ action: { kind: "write", isExternalSend: true } }),
      base({ server: { verificationStatus: "verified", riskLevel: "restricted", recommendedPermission: "read_only" } })
    ];
    for (const input of cases) {
      expect(authorizeToolCall(input).decision).not.toBe("allowed");
    }
  });
});

describe("effectiveGrantPermission — DB booleans → permission", () => {
  const cases: [Parameters<typeof effectiveGrantPermission>[0], McpDefaultPermission][] = [
    [{ canRead: true, canWrite: false, canExecute: false, canDelete: false, requiresApproval: false }, "read_only"],
    [{ canRead: true, canWrite: true, canExecute: false, canDelete: false, requiresApproval: false }, "draft_only"],
    [{ canRead: true, canWrite: true, canExecute: false, canDelete: false, requiresApproval: true }, "approval_required"],
    [{ canRead: false, canWrite: false, canExecute: false, canDelete: false, requiresApproval: true }, "blocked"],
    [{ canRead: false, canWrite: false, canExecute: false, canDelete: false, requiresApproval: false }, "blocked"]
  ];
  it.each(cases)("maps %o → %s", (grant, expected) => {
    expect(effectiveGrantPermission(grant)).toBe(expected);
  });
});
