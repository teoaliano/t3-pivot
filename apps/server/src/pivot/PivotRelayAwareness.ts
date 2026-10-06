/**
 * Tells the agent-awareness relay which threads are teammates (they publish
 * nothing) and how many decisions each Pivot holds for the user (a Pivot with
 * any reads as waiting for input, so mobile pushes it), and when that changes.
 *
 * @module PivotRelayAwareness
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { PivotAwareness } from "../relay/PivotAwareness.ts";
import * as PivotStore from "./PivotStore.ts";

export const layer = Layer.effect(
  PivotAwareness,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return {
      roleOf: (threadId) =>
        Effect.gen(function* () {
          const pivot = yield* store.getPivot(threadId);
          if (pivot !== null) {
            return { kind: "pivot" as const, escalatedDecisions: pivot.escalatedDecisionCount };
          }
          return (yield* store.getTeammate(threadId)) === null
            ? null
            : { kind: "teammate" as const };
        }).pipe(Effect.orElseSucceed(() => null)),
      changes: Stream.suspend(() => {
        const counts = new Map<string, number>();
        return store.stream.pipe(
          Stream.flatMap((event) => {
            const changed: Array<ThreadId> = [];
            for (const pivot of event.pivots) {
              const before = counts.get(pivot.threadId);
              counts.set(pivot.threadId, pivot.escalatedDecisionCount);
              if (event._tag === "changed" && before !== pivot.escalatedDecisionCount) {
                changed.push(pivot.threadId);
              }
            }
            return Stream.fromIterable(changed);
          }),
          Stream.catchCause(() => Stream.empty),
        );
      }),
    };
  }),
);
