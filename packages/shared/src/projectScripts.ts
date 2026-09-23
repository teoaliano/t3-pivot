import type { ProjectId, ProjectScript, ServerSettings } from "@t3tools/contracts";

type ProjectScriptSettings = Pick<
  ServerSettings,
  | "defaultProjectScripts"
  | "projectScriptOverrides"
  | "projectSettingsOverrides"
  | "projectSettingsFolded"
>;

/**
 * The project's override wins, then environment defaults. Until the legacy
 * fields have been folded into `projectSettingsOverrides`, the old map (null
 * there meant "reset to machine defaults") and the aggregate's own scripts
 * still count, so a server that has not run the fold yet behaves as before.
 */
export function resolveProjectScripts(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): readonly ProjectScript[] {
  const override = settings.projectSettingsOverrides[project.id]?.defaultProjectScripts;
  if (override !== undefined) return override;
  if (settings.projectSettingsFolded) return settings.defaultProjectScripts;
  const legacy = settings.projectScriptOverrides[project.id];
  if (legacy === null) return settings.defaultProjectScripts;
  return legacy ?? (project.scripts.length > 0 ? project.scripts : settings.defaultProjectScripts);
}

export function projectScriptsInheritDefaults(
  settings: ProjectScriptSettings,
  project: { id: ProjectId; scripts: readonly ProjectScript[] },
): boolean {
  if (settings.projectSettingsOverrides[project.id]?.defaultProjectScripts !== undefined) {
    return false;
  }
  if (settings.projectSettingsFolded) return true;
  const legacy = settings.projectScriptOverrides[project.id];
  return legacy === null || (legacy === undefined && project.scripts.length === 0);
}

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  /** The checkout's reserved port block, for a managed process. */
  ports?: ReadonlyArray<number>;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  // `T3CODE_PORT` is the T3 server's own port, hence the MANAGED infix. Bare
  // `PORT` is set too because most frameworks read it with no configuration;
  // a project's own .env still overrides it.
  input.ports?.forEach((port, index) => {
    env[index === 0 ? "T3CODE_MANAGED_PORT" : `T3CODE_MANAGED_PORT_${index}`] = String(port);
  });
  const [firstPort] = input.ports ?? [];
  if (firstPort !== undefined) {
    env.PORT = String(firstPort);
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "vp", "vpr"]);
const PACKAGE_MANAGER_NON_RUN = new Set([
  "add",
  "install",
  "i",
  "remove",
  "uninstall",
  "exec",
  "x",
]);
const DEV_SCRIPT_NAME = /^(?:dev|start|serve|preview|storybook)(?:[:-].*)?$/;
const EXEC_PREFIXES = new Set(["npx", "bunx", "pnpx", "exec", "dotenv", "--"]);

/** A tool name, the words that must follow it, and words after it that mean it is not serving. */
const DEV_TOOLS: ReadonlyArray<{
  readonly tool: string;
  readonly args?: ReadonlyArray<string>;
  readonly notArgs?: ReadonlyArray<string>;
}> = [
  { tool: "vite", notArgs: ["build", "optimize"] },
  { tool: "next", args: ["dev"] },
  { tool: "next", args: ["start"] },
  { tool: "astro", args: ["dev"] },
  { tool: "nuxt", args: ["dev"] },
  { tool: "nuxi", args: ["dev"] },
  { tool: "remix", args: ["dev"] },
  { tool: "ng", args: ["serve"] },
  { tool: "storybook", args: ["dev"] },
  { tool: "start-storybook" },
  { tool: "webpack", args: ["serve"] },
  { tool: "webpack-dev-server" },
  { tool: "expo", args: ["start"] },
  { tool: "rails", args: ["server"] },
  { tool: "rails", args: ["s"] },
  { tool: "manage.py", args: ["runserver"] },
  { tool: "flask", args: ["run"] },
  { tool: "uvicorn" },
  { tool: "http-server" },
  { tool: "http.server" },
];

function commandWords(segment: string): ReadonlyArray<string> {
  const words = segment
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  let start = 0;
  // Leading `FOO=bar` assignments and runners like `npx` do not name the program.
  while (
    start < words.length &&
    (/^\w+=/.test(words[start]!) || EXEC_PREFIXES.has(words[start]!))
  ) {
    start += 1;
  }
  return words.slice(start).map((word) => word.split("/").at(-1) ?? word);
}

function segmentLooksLikeDevServer(words: ReadonlyArray<string>): boolean {
  const [program, ...rest] = words;
  if (program === undefined) return false;
  if (PACKAGE_MANAGERS.has(program)) {
    const args = rest.filter((word) => !word.startsWith("-"));
    if (args[0] !== undefined && PACKAGE_MANAGER_NON_RUN.has(args[0])) return false;
    return args.some((word) => word !== "run" && DEV_SCRIPT_NAME.test(word));
  }
  return words.some((word, index) =>
    DEV_TOOLS.some((entry) => {
      if (word !== entry.tool) return false;
      const following = words.slice(index + 1);
      if (entry.args && entry.args.some((expected, offset) => following[offset] !== expected)) {
        return false;
      }
      return !(following[0] !== undefined && entry.notArgs?.includes(following[0]));
    }),
  );
}

/**
 * Guesses whether a command runs a dev server: a package manager running a
 * `dev`, `start`, `serve`, `preview` or `storybook` script, or a known dev
 * server started directly. `pnpm start` on a CLI tool guesses wrong, which is
 * what the action's `devServer` field is for.
 */
export function looksLikeDevServerCommand(command: string): boolean {
  return command
    .split(/&&|\|\||;|\|/)
    .some((segment) => segmentLooksLikeDevServer(commandWords(segment)));
}

/** The guess for an action that does not say whether it is a dev server. */
export function inferDevProjectScript(
  script: Pick<ProjectScript, "command" | "previewUrl" | "runOnWorktreeCreate">,
): boolean {
  return (
    !script.runOnWorktreeCreate &&
    (script.previewUrl !== undefined || looksLikeDevServerCommand(script.command))
  );
}

/** A dev action: the action's own `devServer` answer, or the guess when it has none. */
export function isDevProjectScript(script: ProjectScript): boolean {
  return script.devServer ?? inferDevProjectScript(script);
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}
