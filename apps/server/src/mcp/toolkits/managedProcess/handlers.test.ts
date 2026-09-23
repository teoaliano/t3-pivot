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
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
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

const makeHarness = (
  options: {
    readonly occupied?: boolean;
    readonly scripts?: OrchestrationProjectShell["scripts"];
    readonly worktreePath?: string;
    /** What the started process does next: serves a page, exits, or keeps compiling. */
    readonly outcome?: "running" | { readonly exited: string } | "compiling";
  } = {},
) =>
  Effect.gen(function* () {
    const thread = {
      id: THREAD_ID,
      projectId: project.id,
      worktreePath: options.worktreePath ?? "/worktrees/project/feature",
    } as Pick<OrchestrationThreadShell, "id" | "projectId" | "worktreePath">;
    const starts: Array<{ checkoutPath: string; scriptId: string; reallocate: boolean }> = [];
    const commands: Array<string> = [];
    let lastStarted: ManagedProcess | null = null;
    const outcome = options.outcome ?? "running";
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: (threadId) =>
          Effect.succeed(
            threadId === THREAD_ID
              ? Option.some(thread as OrchestrationThreadShell)
              : Option.none(),
          ),
        getProjectShellById: () =>
          Effect.succeed(Option.some({ ...project, scripts: options.scripts ?? project.scripts })),
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
            commands.push(target.script.command);
            if (options.occupied && !reallocate) {
              return yield* new ManagedProcessPortOccupiedError({
                checkoutPath: target.checkoutPath,
                port: 11000,
                occupantPid: 4242,
                occupantProcessName: "postgres",
                occupantCommand: "/usr/bin/postgres -D /other/checkout",
              });
            }
            lastStarted = processOn(reallocate ? 11010 : 11000, target.checkoutPath);
            return lastStarted;
          }),
        stream: (checkoutPath) => {
          const snapshot = (process: ManagedProcess) => ({ checkoutPath, processes: [process] });
          const started = lastStarted!;
          if (outcome === "compiling") {
            return Stream.concat(Stream.make(snapshot(started)), Stream.never);
          }
          const next: ManagedProcess =
            outcome === "running"
              ? { ...started, status: "running" }
              : { ...started, status: "stopped", lastError: outcome.exited };
          return Stream.make(snapshot(started), snapshot(next));
        },
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
    return { starts, commands, call };
  });

describe("managed process toolkit handlers", () => {
  it.effect("starts the calling thread's checkout server, defaulting to the preview script", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call({});

      expect(result).toEqual({
        port: 11000,
        url: "http://localhost:11000",
        status: "running",
        reallocated: false,
      });
      expect(harness.starts).toEqual([
        { checkoutPath: "/worktrees/project/feature", scriptId: "dev", reallocate: false },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("moves to a new port after a conflict and reports only that port", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ occupied: true });
      const result = yield* harness.call({ script: "Dev" });

      // Nothing about the occupant, which belongs to work the agent cannot see.
      expect(result).toEqual({
        port: 11010,
        url: "http://localhost:11010",
        status: "running",
        reallocated: true,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails with the exit reason when the server dies before serving a page", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ outcome: { exited: "Exited with code 127" } });
      const error = yield* harness.call({}).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ManagedProcessExitedError",
        scriptId: "dev",
        reason: "Exited with code 127",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("answers starting when the server is still compiling after 30 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ outcome: "compiling" });
      const pending = yield* harness.call({}).pipe(Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(pending);

      expect(result.status).toBe("starting");
    }).pipe(Effect.provide(NodeServices.layer)),
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
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a credential without the preview capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call({}, ["pull-requests"]).pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "PreviewAutomationUnavailableError" });
      expect(harness.starts).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect("runs the checkout's package.json dev script when the project has no dev action", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const checkout = yield* fs.makeTempDirectoryScoped({ prefix: "t3-detected-dev-" });
      yield* fs.writeFileString(`${checkout}/package.json`, '{"scripts":{"dev":"vite --host"}}');
      yield* fs.writeFileString(`${checkout}/package-lock.json`, "{}");
      const harness = yield* makeHarness({ scripts: [], worktreePath: checkout });
      const result = yield* harness.call({});

      expect(result.port).toBe(11000);
      expect(harness.commands).toEqual(["npm run dev -- --port $PORT --strictPort"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
