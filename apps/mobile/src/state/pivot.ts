import { EMPTY_PIVOT_STATE } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { useEnvironmentServerConfig } from "./entities";
import { serverEnvironment } from "./server";

const NO_PIVOT_MODE = Atom.make(AsyncResult.success(EMPTY_PIVOT_STATE)).pipe(
  Atom.withLabel("mobile-pivot:none"),
);

/**
 * The retired Pivot a thread is, with the Pivot that took over its work, or null for any
 * other thread. Mobile has no Pivot view; a retired Pivot is read-only history here too.
 */
export function useRetiredPivot(
  environmentId: EnvironmentId | null,
  threadId: ThreadId,
): { readonly successorThreadId: ThreadId | null } | null {
  const supported = useEnvironmentServerConfig(environmentId)?.environment.capabilities.pivotMode;
  const result = useAtomValue(
    supported === true && environmentId !== null
      ? serverEnvironment.pivotLive({ environmentId, input: {} })
      : NO_PIVOT_MODE,
  );
  const pivot = Option.getOrNull(AsyncResult.value(result))?.pivots[threadId];
  return pivot === undefined || pivot.retiredAt === null
    ? null
    : { successorThreadId: pivot.successorThreadId };
}
