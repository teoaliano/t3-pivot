const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: one link_pull_request per PR, full URL, every stack layer, as your next call. Host tools do not link for you. If linking fails, say so. Skip PRs you only read or review, and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. Never wait with sleep, loops, gh --watch, Monitor, or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch.
</pull_request_linking>`;

const DEV_SERVER_INSTRUCTIONS = `<dev_servers>
When the t3-code MCP server exposes preview_start_server, use it to start this checkout's dev server instead of running the dev command in your own shell. It runs the server on a port reserved for this checkout, so parallel checkouts never collide, and stops it once nobody uses it. Calling it while the server runs returns the same server. Use the port it returns. Tell the user the server is up only when the tool reports it running. If it reports starting, the server is still compiling, so call the tool again. If it fails because the server exited, run the command in your own shell to read the error. Run a dev server in your own shell only when the tool is unavailable or fails.
</dev_servers>`;

/** The project a Pivot works on: its id for the MCP project tools, and its checkout. */
export interface RuntimeProject {
  readonly projectId: string;
  readonly workspaceRoot: string;
}

/**
 * Omit model and effort when the harness manages them dynamically.
 * `project` is set only for a Pivot, whose home is not the project it works on.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly project?: RuntimeProject | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const projectInfo =
    runtime.project === undefined ? "" : `\n\n${projectInstructions(runtime.project)}`;
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio in your response using Markdown image syntax with absolute file paths. Link any other file you produce using its absolute path so the user can open it in T3 Code's files viewer.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${DEV_SERVER_INSTRUCTIONS}${projectInfo}`;
}

function projectInstructions(project: RuntimeProject): string {
  return `<project_info>Your project's id is ${toSingleLine(project.projectId)} and its checkout is ${toSingleLine(project.workspaceRoot)}. Read the checkout directly, and read teammate worktrees at the paths list_teammates reports. t3_project_read has the project's details. Your working directory is your own home, not the project.</project_info>`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
