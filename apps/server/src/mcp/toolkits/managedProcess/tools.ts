import {
  OrchestratorMcpFailure,
  ManagedProcessExitedError,
  ManagedProcessDependenciesMissingError,
  ManagedProcessPortsExhaustedError,
  ManagedProcessScriptNotFoundError,
  ManagedProcessStartError,
  ManagedProcessStatus,
  ManagedProcessThreadNotFoundError,
  PreviewAutomationUnavailableError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ManagedProcesses from "../../../managedProcess/ManagedProcesses.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../../orchestration-v2/ProjectStore.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";

export const StartServerInput = Schema.Struct({
  script: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Id or name of the project script to run. Omit it to run the project's dev action, or the dev script in package.json when the project has none.",
    }),
  ),
});

export const StartServerResult = Schema.Struct({
  port: Schema.Int.annotate({
    description: "Port reserved for this checkout. The script receives it as PORT.",
  }),
  url: Schema.String,
  status: ManagedProcessStatus.annotate({
    description:
      "running once the port serves a page. starting when it is still compiling after 30 seconds: call this tool again to wait longer.",
  }),
  reallocated: Schema.Boolean.annotate({
    description:
      "True when the checkout's previous port was taken and it moved to a new one. Use the port above.",
  }),
});
export type StartServerResult = typeof StartServerResult.Type;

/** What starting fails with, including the access gate's refusal. */
export const StartServerError = Schema.Union([
  OrchestratorMcpFailure,
  PreviewAutomationUnavailableError,
  ManagedProcessPortsExhaustedError,
  ManagedProcessScriptNotFoundError,
  ManagedProcessThreadNotFoundError,
  ManagedProcessStartError,
  ManagedProcessExitedError,
  ManagedProcessDependenciesMissingError,
]);

const StartServerTool = Tool.make("preview_start_server", {
  description:
    "Start this checkout's dev server from a project script, in a terminal, on the port reserved for this checkout. Prefer this to running the dev command in your own shell: the server gets a port no other checkout can take, and it is stopped once nobody has used it for a while. Calling it again while the server runs returns the same server. It waits up to 30 seconds for the server to serve a page, and fails if the server exits first. Only tell the user the server is up when the status is running.",
  parameters: StartServerInput,
  success: StartServerResult,
  failure: StartServerError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ManagedProcesses.ManagedProcesses,
    ThreadManagementService,
    ProjectStoreV2,
    ServerSettingsService,
    FileSystem.FileSystem,
    Path.Path,
  ],
})
  .annotate(Tool.Title, "Start dev server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const StopServerInput = Schema.Struct({
  script: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Id or name of the project script to stop. Omit it to stop the dev server preview_start_server starts by default.",
    }),
  ),
});

export const StopServerResult = Schema.Struct({
  stopped: Schema.Boolean.annotate({
    description: "False when the server was not running, which is not an error.",
  }),
});
export type StopServerResult = typeof StopServerResult.Type;

export const StopServerError = Schema.Union([
  OrchestratorMcpFailure,
  PreviewAutomationUnavailableError,
  ManagedProcessScriptNotFoundError,
  ManagedProcessThreadNotFoundError,
]);

const StopServerTool = Tool.make("preview_stop_server", {
  description:
    "Stop this checkout's dev server that preview_start_server started, as soon as you have what you needed from it, so its memory comes back. It waits for the port to be free. The checkout keeps its reserved port, so a later start uses the same address. Succeeds when the server is not running.",
  parameters: StopServerInput,
  success: StopServerResult,
  failure: StopServerError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ManagedProcesses.ManagedProcesses,
    ThreadManagementService,
    ProjectStoreV2,
    ServerSettingsService,
    FileSystem.FileSystem,
    Path.Path,
  ],
})
  .annotate(Tool.Title, "Stop dev server")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ManagedProcessToolkit = Toolkit.make(StartServerTool, StopServerTool);
