import type { PivotState } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/**
 * Pivot mode in the sidebar. A Pivot's teammates leave the shelves and sit under
 * their Pivot's row, in dispatch order, shown while the row is expanded. A
 * retired Pivot keeps the teammates it still owns: the ones it finished before a
 * takeover moved its live work on. A teammate whose Pivot is not in the list
 * stays a top-level row, so nothing becomes unreachable.
 */

interface ThreadRef {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}

/** The key a Pivot's teammates are grouped under: its environment and thread id. */
export const pivotNestingKey = (thread: ThreadRef) => `${thread.environmentId}:${thread.id}`;
const keyOf = pivotNestingKey;

export interface PivotNesting<T> {
  /** Every thread that is not nested under a Pivot in the list. */
  readonly topLevel: ReadonlyArray<T>;
  /** Teammates by their Pivot's `environmentId:threadId` key, in dispatch order. */
  readonly teammatesByPivotKey: ReadonlyMap<string, ReadonlyArray<T>>;
}

export function nestPivotTeammates<T extends ThreadRef>(
  threads: ReadonlyArray<T>,
  pivotStateOf: (environmentId: EnvironmentId) => PivotState | null,
): PivotNesting<T> {
  const listed = new Set(threads.map(keyOf));
  const topLevel: Array<T> = [];
  const nested = new Map<string, Array<{ readonly thread: T; readonly dispatchedAt: string }>>();
  for (const thread of threads) {
    const teammate = pivotStateOf(thread.environmentId)?.teammates[thread.id];
    const pivotKey =
      teammate === undefined
        ? null
        : keyOf({ environmentId: thread.environmentId, id: teammate.pivotThreadId });
    if (teammate === undefined || pivotKey === null || !listed.has(pivotKey)) {
      topLevel.push(thread);
      continue;
    }
    const siblings = nested.get(pivotKey) ?? [];
    siblings.push({ thread, dispatchedAt: teammate.dispatchedAt });
    nested.set(pivotKey, siblings);
  }
  return {
    topLevel,
    teammatesByPivotKey: new Map(
      [...nested].map(([pivotKey, siblings]) => [
        pivotKey,
        siblings
          .sort((left, right) => left.dispatchedAt.localeCompare(right.dispatchedAt))
          .map((sibling) => sibling.thread),
      ]),
    ),
  };
}

export interface SidebarPivotRow<T> {
  readonly thread: T;
  /** The Pivot row a teammate sits under; null for a top-level row. */
  readonly nestedUnderKey: string | null;
}

/** A shelf's rows with each expanded Pivot's teammates right after it. */
export function interleavePivotTeammates<T extends ThreadRef>(
  rows: ReadonlyArray<T>,
  teammatesByPivotKey: ReadonlyMap<string, ReadonlyArray<T>>,
  expandedPivotKeys: ReadonlySet<string>,
): ReadonlyArray<SidebarPivotRow<T>> {
  const result: Array<SidebarPivotRow<T>> = [];
  for (const thread of rows) {
    result.push({ thread, nestedUnderKey: null });
    const key = keyOf(thread);
    if (!expandedPivotKeys.has(key)) continue;
    for (const teammate of teammatesByPivotKey.get(key) ?? []) {
      result.push({ thread: teammate, nestedUnderKey: key });
    }
  }
  return result;
}

export interface SidebarPivotBadge {
  readonly retired: boolean;
  /** Decisions the Pivot holds for the user. */
  readonly escalatedDecisions: number;
  readonly teammateCount: number;
}

/** The badge a Pivot's row shows; null for any other thread. */
export function sidebarPivotBadge(
  thread: ThreadRef,
  pivotState: PivotState | null,
  teammateCount: number,
): SidebarPivotBadge | null {
  const pivot = pivotState?.pivots[thread.id];
  if (pivot === undefined) return null;
  return {
    retired: pivot.retiredAt !== null,
    escalatedDecisions: pivot.escalatedDecisionCount,
    teammateCount,
  };
}

/**
 * Teammates send no desktop notification, sound, badge or push of their own: their
 * news reaches the user through their Pivot.
 */
export function threadNotifiesUser(threadId: ThreadId, pivotState: PivotState | null): boolean {
  return pivotState?.teammates[threadId] === undefined;
}
