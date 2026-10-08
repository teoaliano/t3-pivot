/**
 * ThreadToolRestrictions - threads whose agent gets no browser or device tools,
 * whatever the agent-access settings allow.
 *
 * T3 Pivot provides it so a Pivot supervises and its teammates verify. The
 * default restricts nothing, which leaves V2's behavior as it was.
 *
 * @module ThreadToolRestrictions
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export class ThreadToolRestrictions extends Context.Reference<{
  /** Whether the thread's agent goes without browser and device tools. */
  readonly withoutBrowserOrDevice: (threadId: ThreadId) => Effect.Effect<boolean>;
}>("t3/orchestration-v2/ThreadToolRestrictions", {
  defaultValue: () => ({ withoutBrowserOrDevice: () => Effect.succeed(false) }),
}) {}
