/**
 * Tells V2's restart recovery that a Pivot and its teammates carry on after a
 * restart whatever the continue-after-update setting says, and marks a teammate
 * as resuming so it reads `working`, not stopped, until its run is back.
 *
 * @module PivotCarryOn
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { RestartCarryOn } from "../orchestration-v2/RestartCarryOn.ts";
import * as PivotStore from "./PivotStore.ts";

export const layer = Layer.effect(
  RestartCarryOn,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return {
      carriesOn: (threadId) =>
        Effect.gen(function* () {
          const pivot = yield* store.getPivot(threadId);
          if (pivot !== null) return pivot.retiredAt === null;
          const teammate = yield* store.getTeammate(threadId);
          return teammate !== null && teammate.tornDownAt === null;
        }).pipe(Effect.orElseSucceed(() => false)),
      resuming: (threadId) =>
        store.getTeammate(threadId).pipe(
          Effect.flatMap((teammate) =>
            teammate === null
              ? Effect.void
              : store.dispatch({ type: "teammate.set-resume", threadId, resume: "pending" }),
          ),
          Effect.ignore,
        ),
    };
  }),
);
