export type RunGuidance = {
  title: string;
  reason: string;
  nextAction: string;
  actionTarget: "retry" | "profile" | "grants" | "activity";
};

export function terminalRunGuidance(status: string, rawReason?: string | null): RunGuidance {
  const reason = (rawReason || "The run stopped before it produced a final result.").trim();
  const lower = reason.toLowerCase();

  if (status === "halted_cost" || lower.includes("cost") || lower.includes("budget")) {
    return {
      title: "Run paused at its spending limit",
      reason,
      nextAction: "Reduce the task or increase this flow’s run budget, then start a new run.",
      actionTarget: "activity"
    };
  }
  // The draft-only default (Chunk 20) is the most common reason a send "silently"
  // does not happen: a new account is never granted a send tool at all, so the
  // gate blocks it as ungranted. Name the actual remedy rather than sending the
  // user to inspect grants that were never created.
  if (lower.includes("send") && (lower.includes("allow-list") || lower.includes("allow list"))) {
    return {
      title: "Real sending is not enabled for this account",
      reason,
      nextAction:
        "New accounts are draft-only. Turn on real sending in Profile, re-plan the flow so a send step can be granted, then run again.",
      actionTarget: "profile"
    };
  }
  // A mandate refusal splits two ways, and the difference matters: an AUTHORITY
  // problem (scope/limit) belongs in grants, while a CONNECTION problem (no token)
  // belongs in Profile and is handled by the credential branch below. Match the
  // authority reasons specifically — not "broker refused" generally, which is both.
  if (lower.includes("scope") || lower.includes("exceeds grant limit")) {
    return {
      title: "This action is outside what you authorized",
      reason,
      nextAction: "Review the agent’s tool grants and re-grant the action you intend to allow, then start a new run.",
      actionTarget: "grants"
    };
  }
  if (lower.includes("api key") || lower.includes("credential") || lower.includes("oauth") || lower.includes("token")) {
    return {
      title: "Account connection needs attention",
      reason,
      nextAction: "Open Profile, repair the missing model or Google connection, then start a new run.",
      actionTarget: "profile"
    };
  }
  if (lower.includes("grant") || lower.includes("tool") && (lower.includes("blocked") || lower.includes("unavailable") || lower.includes("revoked"))) {
    return {
      title: "This flow is missing tool access",
      reason,
      nextAction: "Review the agent’s tool grants, restore the required access, then start a new run.",
      actionTarget: "grants"
    };
  }
  if (status === "killed") {
    return {
      title: "Run stopped",
      reason,
      nextAction: "Nothing else will execute. Start a new run when you are ready.",
      actionTarget: "retry"
    };
  }
  return {
    title: "The run could not finish",
    reason,
    nextAction: "Review the last failed step below, then start a new run. The previous run remains in Activity for audit.",
    actionTarget: "retry"
  };
}
