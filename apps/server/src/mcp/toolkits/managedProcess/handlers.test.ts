import {
  EnvironmentId,
  ManagedProcessPortOccupiedError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ManagedProcess,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as ManagedProcesses from "../../../managedProcess/ManagedProcesses.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ManagedProcessToolkitHandlersLive } from "./handlers.ts";
import { ManagedProcessToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-1");

const project: OrchestrationProjectShell = {
  id: ProjectId.make("project-1"),
  title: "Project",
  workspaceRoot: "/workspace/project",
  defaultModelSelection: null,
  scripts: [
    { id: "lint", name: "Lint", command: "pnpm lint", icon: "lint", runOnWorktreeCreate: false },
    {
      id: "dev",
      name: "Dev",
      command: "pnpm dev",
      icon: "play",
      runOnWorktreeCreate: false,
      previewUrl: "http://localhost:5173",
    },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const thread = {
  id: THREAD_ID,
  projectId: project.id,
  worktreePath: "/worktrees/project/feature",
} as Pick<OrchestrationThreadShell, "id" | "projectId" | "worktreePath">;

const processOn = (port: number, checkoutPath: string): ManagedProcess => ({
  checkoutPath,
  scriptId: "dev",
  scriptName: "Dev",
  status: "starting",
  port,
  pinned: false,
  lastError: null,
  terminal: { threadId: "managed-process:abc", terminalId: "dev" },
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeHarness = (options: { readonly occupied?: boolean } = {}) =>
  Effect.gen(function* () {
    const starts: Array<{ checkoutPath: string; scriptId: string; reallocate: boolean }> = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: (threadId) =>
          Effect.succeed(
            threadId === THREAD_ID
              ? Option.some(thread as OrchestrationThreadShell)
              : Option.none(),
          ),
        getProjectShellById: () => Effect.succeed(Option.some(project)),
      }),
      Layer.mock(ManagedProcesses.ManagedProcesses)({
        start: (target, startOptions) =>
          Effect.gen(function* () {
            const reallocate = startOptions?.reallocate === true;
            starts.push({
              checkoutPath: target.checkoutPath,
              scriptId: target.script.id,
              reallocate,
            });
            if (options.occupied && !reallocate) {
              return yield* new ManagedProcessPortOccupiedError({
                checkoutPath: target.checkoutPath,
                port: 11000,
                occupantPid: 4242,
                occupantProcessName: "postgres",
                occupantCommand: "/usr/bin/postgres -D /other/checkout",
              });
            }
            return processOn(reallocate ? 11010 : 11000, target.checkoutPath);
          }),
      }),
      ServerSettings.layerTest(),
    );
    const toolkit = yield* ManagedProcessToolkit.pipe(
      Effect.provide(ManagedProcessToolkitHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const call = (
      params: { readonly script?: string },
      capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["preview"],
    ) =>
      toolkit.handle("preview_start_server", params).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map(
          (chunk) =>
            chunk.at(-1)!.result as Tool.Success<
              (typeof ManagedProcessToolkit.tools)["preview_start_server"]
            >,
        ),
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
        Effect.provide(dependencies),
      );
    return { starts, call };
  });

describe("managed process toolkit handlers", () => {
  it.effect("starts the calling thread's checkout server, defaulting to the preview script", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call({});

      expect(result).toEqual({
        port: 11000,
        url: "http://localhost:11000",
        status: "starting",
        reallocated: false,
      });
      expect(harness.starts).toEqual([
        { checkoutPath: "/worktrees/project/feature", scriptId: "dev", reallocate: false },
      ]);
    }),
  );

  it.effect("moves to a new port after a conflict and reports only that port", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ occupied: true });
      const result = yield* harness.call({ script: "Dev" });

      // Nothing about the occupant, which belongs to work the agent cannot see.
      expect(result).toEqual({
        port: 11010,
        url: "http://localhost:11010",
        status: "starting",
        reallocated: true,
      });
    }),
  );

  it.effect("names the available scripts when the requested one does not exist", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call({ script: "storybook" }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ManagedProcessScriptNotFoundError",
        availableScripts: ["Lint", "Dev"],
      });
      expect(harness.starts).toEqual([]);
    }),
  );

  it.effect("refuses a credential without the preview capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call({}, ["pull-requests"]).pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "PreviewAutomationUnavailableError" });
      expect(harness.starts).toEqual([]);
    }),
  );
});
