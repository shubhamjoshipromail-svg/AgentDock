import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("stabilization UI invariants", () => {
  it("E4: workspace and Build drawer share one planner state and never show both inputs", () => {
    const workspace = source("components/workspace/FlowWorkspace.tsx");

    expect(workspace).not.toContain("builderPrompt");
    expect(workspace).not.toContain("setBuilderPrompt");
    expect(workspace).toContain("prompt={describeText}");
    expect(workspace).toContain("setPrompt={setDescribeText}");
    expect(workspace).toContain('{openDrawer !== "build" && (');
  });
});
