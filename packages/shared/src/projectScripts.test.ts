import { describe, expect, it } from "vite-plus/test";

import { projectScriptRuntimeEnv } from "./projectScripts.ts";

const block = [11020, 11021, 11022, 11023, 11024, 11025, 11026, 11027, 11028, 11029];

describe("projectScriptRuntimeEnv", () => {
  it("exports the checkout's port block, with the first port as PORT", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      worktreePath: "/worktrees/repo/feature",
      ports: block,
    });

    expect(env).toEqual({
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/worktrees/repo/feature",
      T3CODE_MANAGED_PORT: "11020",
      T3CODE_MANAGED_PORT_1: "11021",
      T3CODE_MANAGED_PORT_2: "11022",
      T3CODE_MANAGED_PORT_3: "11023",
      T3CODE_MANAGED_PORT_4: "11024",
      T3CODE_MANAGED_PORT_5: "11025",
      T3CODE_MANAGED_PORT_6: "11026",
      T3CODE_MANAGED_PORT_7: "11027",
      T3CODE_MANAGED_PORT_8: "11028",
      T3CODE_MANAGED_PORT_9: "11029",
      PORT: "11020",
    });
  });

  it("lets a caller-supplied value win over the injected port", () => {
    const env = projectScriptRuntimeEnv({
      project: { cwd: "/repo" },
      ports: block,
      extraEnv: { PORT: "3000" },
    });

    expect(env.PORT).toBe("3000");
    expect(env.T3CODE_MANAGED_PORT).toBe("11020");
  });

  it("sets no port variables for a script run without a block", () => {
    expect(projectScriptRuntimeEnv({ project: { cwd: "/repo" } })).toEqual({
      T3CODE_PROJECT_ROOT: "/repo",
    });
  });
});
