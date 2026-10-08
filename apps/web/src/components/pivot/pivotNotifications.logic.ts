import type { PivotState } from "@t3tools/client-runtime/pivot-state";
import type { ThreadId } from "@t3tools/contracts";

/**
 * What a Pivot tells the user without being asked: a decision newly held for them,
 * or a scout's findings recorded. Both open the Pivot.
 */
export type PivotNotice =
  | { readonly kind: "decision"; readonly pivotThreadId: ThreadId }
  | {
      readonly kind: "findings";
      readonly pivotThreadId: ThreadId;
      readonly teammateTitle: string;
    };

/** The notices between two states of one environment's records. The first state raises none. */
export function pivotNoticesBetween(
  previous: PivotState | null,
  next: PivotState,
): ReadonlyArray<PivotNotice> {
  if (previous === null) return [];
  const notices: Array<PivotNotice> = [];
  for (const pivot of Object.values(next.pivots)) {
    const before = previous.pivots[pivot.threadId]?.escalatedDecisionCount ?? 0;
    if (pivot.escalatedDecisionCount > before) {
      notices.push({ kind: "decision", pivotThreadId: pivot.threadId });
    }
  }
  for (const teammate of Object.values(next.teammates)) {
    if (teammate.hasScoutReport && previous.teammates[teammate.threadId]?.hasScoutReport !== true) {
      notices.push({
        kind: "findings",
        pivotThreadId: teammate.pivotThreadId,
        teammateTitle: teammate.title,
      });
    }
  }
  return notices;
}
