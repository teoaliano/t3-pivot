/**
 * RestartCarryOn - threads that resume after a server restart whatever the
 * project's continue-after-update setting says.
 *
 * T3 Pivot provides it so a Pivot and its teammates carry on by themselves. The
 * default carries nothing on, which leaves V2's behavior as it was.
 *
 * @module RestartCarryOn
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface RestartCarryOnShape {
  /** Whether the thread resumes an interrupted run after a restart regardless of settings. */
  readonly carriesOn: (threadId: ThreadId) => Effect.Effect<boolean>;
  /** Startup recovery scheduled the thread's interrupted run to resume. */
  readonly resuming: (threadId: ThreadId) => Effect.Effect<void>;
}

export class RestartCarryOn extends Context.Reference<RestartCarryOnShape>(
  "t3/orchestration-v2/RestartCarryOn",
  {
    defaultValue: () => ({
      carriesOn: () => Effect.succeed(false),
      resuming: () => Effect.void,
    }),
  },
) {}
