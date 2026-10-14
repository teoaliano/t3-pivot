/**
 * ThreadAdmission - which threads' agents are background work when memory is short.
 *
 * A background agent starts only with memory to spare, one at a time and spaced out;
 * any other agent is held back only when memory is starved. T3 Pivot marks its
 * teammates. The default marks nothing.
 *
 * @module ThreadAdmission
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export class ThreadAdmission extends Context.Reference<{
  readonly isBackgroundAgent: (threadId: ThreadId) => Effect.Effect<boolean>;
}>("t3/orchestration-v2/ThreadAdmission", {
  defaultValue: () => ({ isBackgroundAgent: () => Effect.succeed(false) }),
}) {}
