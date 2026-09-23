import { ManagedProcessExitedError, ManagedProcessStartError } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ManagedProcesses from "../../../managedProcess/ManagedProcesses.ts";
import { resolveManagedScriptTarget } from "../../../managedProcess/resolveScriptTarget.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ManagedProcessToolkit, type StartServerResult } from "./tools.ts";

/**
 * Shorter than the 60 seconds after which agent harnesses such as Claude Code
 * abandon a tool call. At 60 the agent got "operation timed out" instead of
 * the starting answer.
 */
const READY_WAIT = Duration.seconds(30);

export const ManagedProcessToolkitHandlersLive = ManagedProcessToolkit.toLayer(
  Effect.succeed(
    ManagedProcessToolkit.of({
      preview_start_server: (input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.requireMcpCapability("preview");
          const processes = yield* ManagedProcesses.ManagedProcesses;
          const target = yield* resolveManagedScriptTarget(scope.threadId, input.script);
          // An agent cannot act on another checkout's identity, so a taken port
          // is resolved for it: move to a new block and report only the new port.
          const { started, reallocated } = yield* processes.start(target).pipe(
            Effect.map((started) => ({ started, reallocated: false })),
            Effect.catchTag("ManagedProcessPortOccupiedError", () =>
              processes
                .start(target, { reallocate: true })
                .pipe(Effect.map((started) => ({ started, reallocated: true }))),
            ),
            // A second conflict on the fresh block is still not the agent's to resolve.
            Effect.catchTag("ManagedProcessPortOccupiedError", () =>
              Effect.fail(
                new ManagedProcessStartError({
                  checkoutPath: target.checkoutPath,
                  scriptId: target.script.id,
                  cause: "The newly reserved port is taken too.",
                }),
              ),
            ),
          );
          // Answering at launch let agents report a server that had already
          // died, so wait for the process to serve a page or exit.
          const settled = yield* processes.stream(target.checkoutPath).pipe(
            Stream.map((snapshot) =>
              snapshot.processes.find((process) => process.scriptId === target.script.id),
            ),
            Stream.filter((process) => process !== undefined && process.status !== "starting"),
            Stream.runHead,
            Effect.timeoutOption(READY_WAIT),
            Effect.map(Option.flatten),
          );
          const current = Option.getOrElse(settled, () => started);
          if (current?.status === "stopped") {
            return yield* new ManagedProcessExitedError({
              checkoutPath: target.checkoutPath,
              scriptId: target.script.id,
              reason: current.lastError,
            });
          }
          return {
            port: started.port,
            url: `http://localhost:${started.port}`,
            status: current?.status ?? started.status,
            reallocated,
          } satisfies StartServerResult;
        }),
    }),
  ),
);
