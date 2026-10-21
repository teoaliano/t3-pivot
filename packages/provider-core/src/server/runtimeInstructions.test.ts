import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("steers dev servers through the managed start tool instead of the agent's shell", () => {
    const instructions = buildRuntimeInstructions({ harness: "Claude Code" });
    expect(instructions).toContain("When the t3-code MCP server exposes preview_start_server");
    expect(instructions).toContain("instead of running the dev command in your own shell");
    expect(instructions).toContain("Use the port it returns");
  });

  it("names a Pivot's project id and checkout, and omits them otherwise", () => {
    const project = { projectId: "project-1", workspaceRoot: "/repos/checkout" };
    const withProject = buildRuntimeInstructions({ harness: "Codex", project });
    expect(withProject).toContain(
      "Your project's id is project-1 and its checkout is /repos/checkout.",
    );
    expect(buildRuntimeInstructions({ harness: "Codex" })).not.toContain("<project_info>");
  });
});
