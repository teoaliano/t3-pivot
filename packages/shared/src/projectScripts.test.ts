import { describe, expect, it } from "vite-plus/test";

import type { ProjectScript } from "@t3tools/contracts";

import {
  isDevProjectScript,
  looksLikeDevServerCommand,
  projectScriptRuntimeEnv,
} from "./projectScripts.ts";

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

const action = (overrides: Partial<ProjectScript>): ProjectScript => ({
  id: "action",
  name: "Action",
  command: "pnpm dev",
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

describe("isDevProjectScript", () => {
  it("takes the action's own answer over the guess", () => {
    expect(isDevProjectScript(action({ command: "pnpm start", devServer: false }))).toBe(false);
    expect(isDevProjectScript(action({ command: "./run.sh", devServer: true }))).toBe(true);
  });

  it("counts an action with a preview URL, whatever its command", () => {
    expect(
      isDevProjectScript(action({ command: "./run.sh", previewUrl: "http://localhost:3000" })),
    ).toBe(true);
  });

  it("guesses from the command, not the icon", () => {
    expect(isDevProjectScript(action({ command: "pnpm test", icon: "play" }))).toBe(false);
    expect(isDevProjectScript(action({ command: "pnpm dev", icon: "configure" }))).toBe(true);
  });

  it("never guesses a setup action is a dev server", () => {
    expect(isDevProjectScript(action({ command: "pnpm dev", runOnWorktreeCreate: true }))).toBe(
      false,
    );
  });
});

describe("looksLikeDevServerCommand", () => {
  it.each([
    "pnpm dev",
    "npm run start",
    "yarn dev:web",
    "bun run storybook",
    "pnpm --filter web dev",
    "pnpm install && pnpm dev",
    "PORT=3000 npm start",
    "npx vite --port $PORT --strictPort",
    "./node_modules/.bin/next dev",
    "python manage.py runserver",
    "python -m http.server $PORT",
    "bundle exec rails s",
    "vp run dev",
  ])("recognises %s", (command) => {
    expect(looksLikeDevServerCommand(command)).toBe(true);
  });

  it.each([
    "pnpm test",
    "pnpm lint --fix",
    "npm run build",
    "vite build",
    "pnpm add serve",
    "cargo test",
    "./run.sh",
  ])("does not recognise %s", (command) => {
    expect(looksLikeDevServerCommand(command)).toBe(false);
  });
});
