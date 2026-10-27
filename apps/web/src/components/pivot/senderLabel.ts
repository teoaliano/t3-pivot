import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { usePivotStatesStore } from "./pivotStatesStore";

/** Whether a message from another thread was sent by a Pivot rather than another agent. */
export function useIsPivotSender(
  environmentId: EnvironmentId,
  senderThreadId: ThreadId | undefined,
): boolean {
  return usePivotStatesStore((store) =>
    senderThreadId === undefined
      ? false
      : store.byEnvironment[environmentId]?.pivots[senderThreadId] !== undefined,
  );
}
