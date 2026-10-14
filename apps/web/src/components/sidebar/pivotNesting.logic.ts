import {
  decisionsHeldBy,
  type PivotState,
  teammatesOfPivot,
} from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { SidebarThreadStatus } from "../Sidebar.logic";

import { type TeammateCard, type TeammateCardShell, teammateCard } from "../pivot/pivotCards.logic";

/**
 * Pivot mode in the sidebar. A Pivot's teammates leave the shelves: the sidebar lists
 * only Pivots, and each Pivot's teammates sit in its right panel. Search still finds
 * them, grouped by Pivot in dispatch order. A teammate whose Pivot is not in the list
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

export interface SidebarPivotGroup {
  readonly retired: boolean;
  /** Every teammate not settled, in dispatch order, as the Pivot view's cards. */
  readonly teammates: ReadonlyArray<TeammateCard>;
  /** Teammates that need the user (waiting, blocked, failed), plus the Pivot's own decisions. */
  readonly needYou: number;
  /** Teammates still working. */
  readonly working: number;
  /** Teammates finished, settled or not, so the count reads as the Pivot's record. */
  readonly done: number;
}

/** What a Pivot's sidebar row sums up and lists; null for any other thread. */
export function sidebarPivotGroup(
  pivotState: PivotState | null,
  pivotThreadId: ThreadId,
  shellOf: (threadId: ThreadId) => TeammateCardShell | null,
): SidebarPivotGroup | null {
  const pivot = pivotState?.pivots[pivotThreadId];
  if (pivotState == null || pivot === undefined) return null;
  const cards = teammatesOfPivot(pivotState, pivotThreadId).map((teammate) =>
    teammateCard(teammate, shellOf(teammate.threadId)),
  );
  const teammates = cards.filter((card) => !card.settled);
  const ownDecisions = decisionsHeldBy(pivotState, pivotThreadId).filter(
    (decision) => decision.teammateThreadId === null,
  ).length;
  return {
    retired: pivot.retiredAt !== null,
    teammates,
    // The tones that are neither working nor finished: the orange and red ones.
    needYou:
      teammates.filter((card) => card.tone === "attention" || card.tone === "failed").length +
      ownDecisions,
    working: teammates.filter((card) => card.tone === "working").length,
    // Settled cards are finished for good, whatever their last report said.
    done: cards.filter((card) => card.settled || card.tone === "resting").length,
  };
}

/** Whether a Pivot's row has any teammate to count; with none, it shows no count. */
export const pivotGroupHasTeammates = (group: SidebarPivotGroup): boolean =>
  group.needYou > 0 || group.working > 0 || group.done > 0;

/**
 * Whether a thread entering `status` notifies the user. A teammate does only while a
 * question or approval holds it for the user; the rest of its news reaches the user
 * through its Pivot.
 */
export function threadNotifiesUser(
  threadId: ThreadId,
  pivotState: PivotState | null,
  status: SidebarThreadStatus,
): boolean {
  return (
    pivotState?.teammates[threadId] === undefined || status === "input" || status === "approval"
  );
}
