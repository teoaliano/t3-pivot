import { EMPTY_PIVOT_STATE, type PivotState } from "@t3tools/client-runtime/pivot-state";
import { ProjectId, type TeammateRecord, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pivotNoticesBetween } from "./pivotNotifications.logic";

const pivotId = ThreadId.make("pivot");
const state = (escalated: number, scoutReport: boolean): PivotState => ({
  pivots: {
    pivot: {
      threadId: pivotId,
      projectId: ProjectId.make("project"),
      createdAt: "2026-10-06T00:00:00.000Z",
      retiredAt: null,
      successorThreadId: null,
      openDecisionCount: escalated,
      escalatedDecisionCount: escalated,
    },
  },
  teammates: {
    scout: {
      threadId: ThreadId.make("scout"),
      pivotThreadId: pivotId,
      projectId: ProjectId.make("project"),
      kind: "scout",
      title: "Why is login slow",
      branch: "pivot/why-is-login-slow",
      report: null,
      resume: null,
      hasEscalatedDecision: false,
      hasScoutReport: scoutReport,
      dispatchedAt: "2026-10-06T00:00:00.000Z",
      tornDownAt: null,
    } satisfies TeammateRecord,
  },
  decisions: {},
});

describe("Pivot notices", () => {
  it("raises nothing for the first state it sees", () => {
    expect(pivotNoticesBetween(null, state(2, true))).toEqual([]);
  });

  it("raises a decision newly held for the user, not one already there or answered", () => {
    expect(pivotNoticesBetween(state(1, false), state(2, false))).toEqual([
      { kind: "decision", pivotThreadId: pivotId },
    ]);
    expect(pivotNoticesBetween(state(2, false), state(2, false))).toEqual([]);
    expect(pivotNoticesBetween(state(2, false), state(1, false))).toEqual([]);
    expect(pivotNoticesBetween(EMPTY_PIVOT_STATE, state(1, false))).toEqual([
      { kind: "decision", pivotThreadId: pivotId },
    ]);
  });

  it("raises a scout's findings once they are recorded", () => {
    expect(pivotNoticesBetween(state(0, false), state(0, true))).toEqual([
      { kind: "findings", pivotThreadId: pivotId, teammateTitle: "Why is login slow" },
    ]);
    expect(pivotNoticesBetween(state(0, true), state(0, true))).toEqual([]);
  });
});
