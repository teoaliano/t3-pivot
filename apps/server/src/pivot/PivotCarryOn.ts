/**
 * Tells V2's restart recovery that a Pivot and its teammates carry on after a
 * restart whatever the continue-after-update setting says, and marks a teammate
 * as resuming so it reads `working`, not stopped, until its run is back. A teammate
 * this environment hosts for another environment's Pivot carries on too.
 *
 * @module PivotCarryOn
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RestartCarryOn from "../orchestration-v2/RestartCarryOn.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import * as PivotStore from "./PivotStore.ts";

export const layer = Layer.effect(
  RestartCarryOn.RestartCarryOn,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    const hostStore = yield* PivotHostStore.PivotHostStore;
    return {
      carriesOn: Effect.fn("PivotCarryOn.carriesOn")(
        function* (threadId) {
          const pivot = yield* store.getPivot(threadId);
          if (pivot !== null) return pivot.retiredAt === null;
          const teammate = yield* store.getTeammate(threadId);
          if (teammate !== null) return teammate.tornDownAt === null;
          return yield* hostStore.isLive(threadId);
        },
        Effect.orElseSucceed(() => false),
      ),
      resuming: Effect.fn("PivotCarryOn.resuming")((threadId) =>
        store.getTeammate(threadId).pipe(
          Effect.flatMap((teammate) =>
            teammate === null
              ? Effect.void
              : store.dispatch({ type: "teammate.set-resume", threadId, resume: "pending" }),
          ),
          Effect.ignore,
        ),
      ),
    };
  }),
);
