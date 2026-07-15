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

  it("E5: the selected flow exposes a soft-archive action that clears the workspace selection", () => {
    const workspace = source("components/workspace/FlowWorkspace.tsx");

    expect(workspace).toContain("archiveFlow(flowId)");
    expect(workspace).toContain("Archive flow");
    expect(workspace).toContain("onFlowChange?.(null)");
  });

  it("E6: role details and tool access share one participant inspector", () => {
    const builder = source("components/build/Builder.tsx");

    expect(builder).toContain(">Participant</button>");
    expect(builder).toContain("<h3>Tool grants</h3>");
    expect(builder).not.toContain(">Step</button>");
    expect(builder).not.toContain(">Grants</button>");
    expect(builder).not.toContain('inspectorTab === "grants"');
  });
});
