/**
 * ScopeSweep - stops what a finished agent left behind. One of this server's claude
 * scopes whose agent is gone but that still holds processes is stopped, once at server
 * start and then on a timer. Scopes of other T3 servers are never touched.
 *
 * @module ScopeSweep
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { AgentScopeOwner } from "./agentScope.ts";
import { procHost, sweepOrphanScopes } from "./scopeReaper.ts";

const SWEEP_EVERY = "2 minutes";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const owner = yield* AgentScopeOwner;
    if ((yield* HostProcess.Platform) !== "linux" || owner.length === 0) return;
    yield* sweepOrphanScopes(procHost, owner, process.pid).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Agent scope sweep failed", { cause })),
      Effect.repeat(Schedule.spaced(SWEEP_EVERY)),
      Effect.forkScoped,
    );
  }),
);
