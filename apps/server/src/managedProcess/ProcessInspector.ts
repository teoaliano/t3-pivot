import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { isProcessAlive } from "../serverRuntimeState.ts";

/**
 * The few questions the managed process service asks about a pid it recorded
 * itself. It never looks up processes by name or path.
 */
export class ProcessInspector extends Context.Service<
  ProcessInspector,
  {
    readonly isAlive: (pid: number) => Effect.Effect<boolean>;
    /** The full command line, or null when the process is gone or unreadable. */
    readonly commandLine: (pid: number) => Effect.Effect<string | null>;
    readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void>;
  }
>()("t3/managedProcess/ProcessInspector") {}

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;

  const commandLine: ProcessInspector["Service"]["commandLine"] = (pid) =>
    runner
      .run(
        platform === "win32"
          ? {
              command: "powershell.exe",
              args: [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
              ],
              timeout: Duration.seconds(5),
              timeoutBehavior: "timedOutResult",
            }
          : {
              command: "ps",
              args: ["-o", "command=", "-p", String(pid)],
              timeout: Duration.seconds(5),
              timeoutBehavior: "timedOutResult",
            },
      )
      .pipe(
        Effect.map((result) => result.stdout.trim() || null),
        Effect.orElseSucceed(() => null),
      );

  return ProcessInspector.of({
    isAlive: (pid) => Effect.sync(() => isProcessAlive(pid)),
    commandLine,
    signal: (pid, signal) =>
      Effect.sync(() => {
        try {
          process.kill(pid, signal);
        } catch {
          // Already gone.
        }
      }),
  });
});

export const layer = Layer.effect(ProcessInspector, make);
