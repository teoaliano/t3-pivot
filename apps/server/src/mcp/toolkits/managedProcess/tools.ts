import {
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
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ManagedProcesses from "../../../managedProcess/ManagedProcesses.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
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
      "starting until the port serves a page. Read the server's ready line in its terminal, then open the URL.",
  }),
  reallocated: Schema.Boolean.annotate({
    description:
      "True when the checkout's previous port was taken and it moved to a new one. Use the port above.",
  }),
});
export type StartServerResult = typeof StartServerResult.Type;

export const StartServerError = Schema.Union([
  PreviewAutomationUnavailableError,
  ManagedProcessPortsExhaustedError,
  ManagedProcessScriptNotFoundError,
  ManagedProcessThreadNotFoundError,
  ManagedProcessStartError,
]);

const StartServerTool = Tool.make("preview_start_server", {
  description:
    "Start this checkout's dev server from a project script, in a terminal, on the port reserved for this checkout. Prefer this to running the dev command in your own shell: the server gets a port no other checkout can take, and it is stopped once nobody has used it for a while. Calling it again while the server runs returns the same server. The first start can take minutes to compile; open the returned URL once the server reports it is ready.",
  parameters: StartServerInput,
  success: StartServerResult,
  failure: StartServerError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ManagedProcesses.ManagedProcesses,
    ProjectionSnapshotQuery,
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

export const ManagedProcessToolkit = Toolkit.make(StartServerTool);
