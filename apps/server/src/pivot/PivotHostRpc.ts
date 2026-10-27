/**
 * The `pivotHost.*` RPC handlers, built outside the WebSocket layer so that layer's one large
 * handler table does not also infer these.
 *
 * @module PivotHostRpc
 */
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as PivotHost from "./PivotHost.ts";
import { callerOfSession, type PivotHostCaller } from "./PivotHostAuthorization.ts";

type Host = PivotHost.PivotHost["Service"];
type InputOf<K extends keyof Host> = Host[K] extends (
  caller: PivotHostCaller,
  input: infer Input,
) => unknown
  ? Input
  : never;

export const handlers = (pivotHost: Host, session: PivotHostCaller) => {
  // What a host link's session may do is decided in PivotHost, from this session's
  // subject and scopes alone.
  const caller = callerOfSession(session);
  // A host link's session is not the owner: it gets the reason and a fixed message, and the
  // cause stays in this server's log.
  const logFailure = (cause: PivotHost.PivotHostServiceError) =>
    cause._tag === "PivotHostRefusedError" || cause._tag === "PivotRefusedError"
      ? Effect.void
      : Effect.logWarning("A Pivot host request failed", { cause });
  const call = <A>(effect: Effect.Effect<A, PivotHost.PivotHostServiceError>) =>
    effect.pipe(Effect.tapError(logFailure), Effect.mapError(PivotHost.pivotHostWireError));
  return {
    [WS_METHODS.pivotHostDescribe]: (input: InputOf<"describe">) =>
      call(pivotHost.describe(caller, input)),
    [WS_METHODS.pivotHostLaunchTeammate]: (input: InputOf<"launchTeammate">) =>
      call(pivotHost.launchTeammate(caller, input)),
    [WS_METHODS.pivotHostSend]: (input: InputOf<"send">) =>
      call(pivotHost.send(caller, input).pipe(Effect.as({}))),
    [WS_METHODS.pivotHostStop]: (input: InputOf<"stop">) =>
      call(pivotHost.stop(caller, input).pipe(Effect.as({}))),
    [WS_METHODS.pivotHostRelaunch]: (input: InputOf<"relaunch">) =>
      call(pivotHost.relaunch(caller, input)),
    [WS_METHODS.pivotHostRetryLaunch]: (input: InputOf<"retryLaunch">) =>
      call(pivotHost.retryLaunch(caller, input)),
    [WS_METHODS.pivotHostSettle]: (input: InputOf<"settle">) =>
      call(pivotHost.settle(caller, input).pipe(Effect.as({}))),
    [WS_METHODS.pivotHostTeardown]: (input: InputOf<"teardown">) =>
      call(pivotHost.teardown(caller, input).pipe(Effect.as({}))),
    [WS_METHODS.pivotHostPullRequestDetail]: (input: InputOf<"pullRequestDetail">) =>
      call(pivotHost.pullRequestDetail(caller, input)),
    [WS_METHODS.pivotHostMergePullRequest]: (input: InputOf<"mergePullRequest">) =>
      call(pivotHost.mergePullRequest(caller, input).pipe(Effect.as({}))),
    [WS_METHODS.pivotHostLand]: (input: InputOf<"land">) => call(pivotHost.land(caller, input)),
    [WS_METHODS.pivotHostEvents]: (input: InputOf<"events">) =>
      pivotHost
        .events(caller, input)
        .pipe(Stream.tapError(logFailure), Stream.mapError(PivotHost.pivotHostWireError)),
  };
};
