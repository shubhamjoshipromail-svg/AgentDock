import { describe, expect, it } from "vitest";

import { terminalRunGuidance } from "../lib/runs/guidance";

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
