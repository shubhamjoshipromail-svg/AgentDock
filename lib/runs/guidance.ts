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
