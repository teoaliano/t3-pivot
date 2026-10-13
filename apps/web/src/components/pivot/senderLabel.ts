import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { usePivotStatesStore } from "./pivotStatesStore";

/** How a message from another thread is attributed: the Pivot's own, or another agent's. */
export function useSenderLabel(environmentId: EnvironmentId, senderThreadId: ThreadId): string {
  const fromPivot = usePivotStatesStore(
    (store) => store.byEnvironment[environmentId]?.pivots[senderThreadId] !== undefined,
  );
  return fromPivot ? "Sent by the Pivot" : "Sent by another agent";
}
