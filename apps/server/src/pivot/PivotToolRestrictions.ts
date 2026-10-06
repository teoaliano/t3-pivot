/**
 * A Pivot gets no browser or device tools: it supervises, and teammates verify.
 *
 * @module PivotToolRestrictions
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadToolRestrictions from "../orchestration-v2/ThreadToolRestrictions.ts";
import * as PivotStore from "./PivotStore.ts";

export const layer = Layer.effect(
  ThreadToolRestrictions.ThreadToolRestrictions,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return {
      withoutBrowserOrDevice: (threadId) =>
        store.getPivot(threadId).pipe(
          Effect.map((pivot) => pivot !== null),
          Effect.orElseSucceed(() => false),
        ),
    };
  }),
);
