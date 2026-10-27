/**
 * ThreadToolRestrictions - threads whose agent gets no browser or device tools,
 * whatever the agent-access settings allow.
 *
 * T3 Pivot provides it so a Pivot supervises and its teammates verify. The
 * default restricts nothing, which leaves V2's behavior as it was.
 *
 * @module ThreadToolRestrictions
 */
import type { OrchestrationV2AppThread, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export class ThreadToolRestrictions extends Context.Reference<{
  /** Whether the thread's agent goes without browser and device tools. */
  readonly withoutBrowserOrDevice: (threadId: ThreadId) => Effect.Effect<boolean>;
  /**
   * Whether the thread's shell may not merge or close PRs: a Pivot's teammate, and any
   * subagent or fork under a teammate or a Pivot. The thread carries its lineage.
   */
  readonly withoutForgeMerge: (
    thread: Pick<OrchestrationV2AppThread, "id" | "lineage">,
  ) => Effect.Effect<boolean>;
}>("t3/orchestration-v2/ThreadToolRestrictions", {
  defaultValue: () => ({
    withoutBrowserOrDevice: () => Effect.succeed(false),
    withoutForgeMerge: () => Effect.succeed(false),
  }),
}) {}
