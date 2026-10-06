/**
 * PivotAwareness - what the agent-awareness relay needs from T3 Pivot's Pivot
 * mode: each thread's role, and which Pivots' escalated decisions changed so the
 * relay republishes them. The default knows no Pivots.
 *
 * @module PivotAwareness
 */
import type { ThreadId } from "@t3tools/contracts";
import type { ThreadAwarenessPivotRole } from "@t3tools/shared/agentAwareness";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export interface PivotAwarenessShape {
  readonly roleOf: (threadId: ThreadId) => Effect.Effect<ThreadAwarenessPivotRole | null>;
  /** Pivot threads whose escalated decisions changed. */
  readonly changes: Stream.Stream<ThreadId>;
}

export class PivotAwareness extends Context.Reference<PivotAwarenessShape>(
  "t3/relay/PivotAwareness",
  { defaultValue: () => ({ roleOf: () => Effect.succeed(null), changes: Stream.empty }) },
) {}
