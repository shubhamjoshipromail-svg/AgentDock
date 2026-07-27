import { describe, expect, it } from "vitest";

import { terminalRunGuidance } from "../lib/runs/guidance";

describe("guidance names the real remedy for a blocked send", () => {
  it("an ungranted send points at the draft-only toggle, not at grants", () => {
    const g = terminalRunGuidance(
      "halted_error",
      "blocked: send_email — tool is not on the agent's allow-list"
    );
    expect(g.title).toMatch(/sending is not enabled/i);
    expect(g.actionTarget).toBe("profile");
    expect(g.nextAction).toMatch(/draft-only/i);
  });

  it("a mandate refusal points at grants, not at the account connection", () => {
    const g = terminalRunGuidance(
      "halted_error",
      "credential broker refused: grant carries no scope, so it cannot authorize this action"
    );
    expect(g.actionTarget).toBe("grants");
    expect(g.title).toMatch(/outside what you authorized/i);
  });
});

describe("terminal run guidance", () => {
  it("routes credentials to Profile", () => {
    const guidance = terminalRunGuidance("halted_error", "credential broker refused: Google token missing");
    expect(guidance.actionTarget).toBe("profile");
    expect(guidance.nextAction).toMatch(/profile/i);
  });

  it("routes missing grants to the grant controls", () => {
    const guidance = terminalRunGuidance("halted_error", "tool grant has been revoked");
    expect(guidance.actionTarget).toBe("grants");
  });

  it("explains cost and generic failures without pretending they succeeded", () => {
    expect(terminalRunGuidance("halted_cost", "cost ceiling reached").title).toMatch(/spending/i);
    expect(terminalRunGuidance("halted_error", "invalid model envelope").title).toMatch(/could not finish/i);
  });
});
