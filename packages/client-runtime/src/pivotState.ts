/**
 * Pivot mode's records on the client: the Pivot stream folded into one state,
 * and the reads the sidebar, the Pivot view and notifications share. Clients
 * join it to V2's thread shells by thread id.
 */
import type {
  PivotDecision,
  PivotRecord,
  PivotStreamEvent,
  ProjectId,
  TeammateRecord,
  ThreadId,
} from "@t3tools/contracts";

export interface PivotState {
  readonly pivots: Readonly<Record<string, PivotRecord>>;
  readonly teammates: Readonly<Record<string, TeammateRecord>>;
  /** Open escalated decisions only: the ones held for the user. */
  readonly decisions: Readonly<Record<string, PivotDecision>>;
}

export const EMPTY_PIVOT_STATE: PivotState = { pivots: {}, teammates: {}, decisions: {} };

const keyed = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const record: Record<string, A> = {};
  for (const item of items) record[key(item)] = item;
  return record;
};

const heldForUser = (decision: PivotDecision) =>
  decision.resolution === null && decision.escalatedAt !== null;

/** Folds one stream event in. A snapshot replaces everything; a change upserts. */
export const applyPivotStreamEvent = (state: PivotState, event: PivotStreamEvent): PivotState => {
  if (event._tag === "snapshot") {
    return {
      pivots: keyed(event.pivots, (pivot) => pivot.threadId),
      teammates: keyed(event.teammates, (teammate) => teammate.threadId),
      decisions: keyed(event.decisions.filter(heldForUser), (decision) => decision.decisionId),
    };
  }
  const decisions = { ...state.decisions };
  for (const decision of event.decisions) {
    if (heldForUser(decision)) decisions[decision.decisionId] = decision;
    else delete decisions[decision.decisionId];
  }
  return {
    pivots:
      event.pivots.length === 0
        ? state.pivots
        : { ...state.pivots, ...keyed(event.pivots, (pivot) => pivot.threadId) },
    teammates:
      event.teammates.length === 0
        ? state.teammates
        : { ...state.teammates, ...keyed(event.teammates, (teammate) => teammate.threadId) },
    decisions: event.decisions.length === 0 ? state.decisions : decisions,
  };
};

export const pivotOf = (state: PivotState, threadId: ThreadId): PivotRecord | null =>
  state.pivots[threadId] ?? null;

export const teammateOf = (state: PivotState, threadId: ThreadId): TeammateRecord | null =>
  state.teammates[threadId] ?? null;

export const activePivotOfProject = (state: PivotState, projectId: ProjectId): PivotRecord | null =>
  Object.values(state.pivots).find(
    (pivot) => pivot.projectId === projectId && pivot.retiredAt === null,
  ) ?? null;

/** A Pivot's teammates in dispatch order, torn-down ones included. */
export const teammatesOfPivot = (
  state: PivotState,
  pivotThreadId: ThreadId,
): ReadonlyArray<TeammateRecord> =>
  Object.values(state.teammates)
    .filter((teammate) => teammate.pivotThreadId === pivotThreadId)
    .sort((left, right) => left.dispatchedAt.localeCompare(right.dispatchedAt));

/** Decisions a Pivot holds for the user, oldest first. */
export const decisionsHeldBy = (
  state: PivotState,
  pivotThreadId: ThreadId,
): ReadonlyArray<PivotDecision> =>
  Object.values(state.decisions)
    .filter((decision) => decision.pivotThreadId === pivotThreadId)
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt));

/** What a takeover would move: the active Pivot's live teammates and open decisions. */
export const takeoverSummary = (state: PivotState, projectId: ProjectId) => {
  const active = activePivotOfProject(state, projectId);
  if (active === null) return null;
  return {
    pivot: active,
    liveTeammates: teammatesOfPivot(state, active.threadId).filter(
      (teammate) => teammate.tornDownAt === null,
    ).length,
    openDecisions: active.openDecisionCount,
  };
};
