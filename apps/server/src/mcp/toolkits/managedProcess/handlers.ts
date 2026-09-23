import { ManagedProcessStartError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ManagedProcesses from "../../../managedProcess/ManagedProcesses.ts";
import { resolveManagedScriptTarget } from "../../../managedProcess/resolveScriptTarget.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ManagedProcessToolkit, type StartServerResult } from "./tools.ts";

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
          return {
            port: started.port,
            url: `http://localhost:${started.port}`,
            status: started.status,
            reallocated,
          } satisfies StartServerResult;
        }),
    }),
  ),
);
