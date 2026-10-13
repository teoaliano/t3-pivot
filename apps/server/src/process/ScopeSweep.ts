/**
 * ScopeSweep - stops what a finished agent left behind. A `t3code-claude-*.scope`
 * whose `claude` process is gone but that still holds processes is stopped, once
 * at server start and then on a timer.
 *
 * @module ScopeSweep
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { procHost, sweepOrphanScopes } from "./scopeReaper.ts";

const SWEEP_EVERY = "2 minutes";

export const layer = Layer.effectDiscard(
  sweepOrphanScopes(procHost).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Agent scope sweep failed", { cause })),
    Effect.repeat(Schedule.spaced(SWEEP_EVERY)),
    Effect.forkScoped,
  ),
);
