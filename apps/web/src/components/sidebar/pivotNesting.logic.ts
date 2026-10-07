import {
  decisionsHeldBy,
  type PivotState,
  teammatesOfPivot,
} from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  type TeammateCard,
  type TeammateCardShell,
  teammateCards,
} from "../pivot/pivotCards.logic";

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

export interface SidebarPivotGroup {
  readonly retired: boolean;
  /** In dispatch order, as the Pivot view's cards. */
  readonly live: ReadonlyArray<TeammateCard>;
  /** Done or cleaned up, behind "N finished". Read from the records, so archived ones stay. */
  readonly finished: ReadonlyArray<TeammateCard>;
  /** Teammates waiting on the user, plus decisions the Pivot holds about its own work. */
  readonly needYou: number;
}

/** What a Pivot's sidebar row sums up and lists; null for any other thread. */
export function sidebarPivotGroup(
  pivotState: PivotState | null,
  pivotThreadId: ThreadId,
  shellOf: (threadId: ThreadId) => TeammateCardShell | null,
): SidebarPivotGroup | null {
  const pivot = pivotState?.pivots[pivotThreadId];
  if (pivotState == null || pivot === undefined) return null;
  const cards = teammateCards(teammatesOfPivot(pivotState, pivotThreadId), shellOf);
  const ownDecisions = decisionsHeldBy(pivotState, pivotThreadId).filter(
    (decision) => decision.teammateThreadId === null,
  ).length;
  return {
    retired: pivot.retiredAt !== null,
    live: cards.live,
    finished: cards.finished,
    needYou: cards.live.filter((card) => card.needsYou).length + ownDecisions,
  };
}

/**
 * Teammates send no desktop notification, sound, badge or push of their own: their
 * news reaches the user through their Pivot.
 */
export function threadNotifiesUser(threadId: ThreadId, pivotState: PivotState | null): boolean {
  return pivotState?.teammates[threadId] === undefined;
}
