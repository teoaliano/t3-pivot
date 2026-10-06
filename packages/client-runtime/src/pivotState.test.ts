import type { PivotDecision, PivotRecord, TeammateRecord } from "@t3tools/contracts";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyPivotStreamEvent,
  EMPTY_PIVOT_STATE,
  takeoverSummary,
  teammatesOfPivot,
} from "./pivotState.ts";

const projectId = ProjectId.make("project-1");
const pivot = (id: string, retiredAt: string | null = null): PivotRecord => ({
  threadId: ThreadId.make(id),
  projectId,
  createdAt: "2026-10-06T00:00:00.000Z",
  retiredAt,
  successorThreadId: null,
  openDecisionCount: 1,
  escalatedDecisionCount: 1,
});
const teammate = (id: string, pivotId: string, at: string, tornDownAt: string | null = null) =>
  ({
    threadId: ThreadId.make(id),
    pivotThreadId: ThreadId.make(pivotId),
    projectId,
    kind: "ship",
    title: id,
    branch: `pivot/${id}`,
    report: null,
    resume: null,
    hasEscalatedDecision: false,
    hasScoutReport: false,
    dispatchedAt: at,
    tornDownAt,
  }) satisfies TeammateRecord;
const decision = (id: string, closed = false) =>
  ({
    decisionId: id,
    pivotThreadId: ThreadId.make("pivot-a"),
    teammateThreadId: null,
    key: "default",
    openedBy: "pivot",
    summary: "Which?",
    openedAt: "2026-10-06T00:00:00.000Z",
    escalation: null,
    escalatedAt: "2026-10-06T00:00:00.000Z",
    userAnswer: null,
    userAnsweredAt: null,
    resolution: closed
      ? { kind: "answered", text: "x", closedAt: "2026-10-06T01:00:00.000Z" }
      : null,
  }) as unknown as PivotDecision;

describe("Pivot state", () => {
  it("replaces on a snapshot and upserts changes, dropping closed decisions", () => {
    let state = applyPivotStreamEvent(EMPTY_PIVOT_STATE, {
      _tag: "snapshot",
      pivots: [pivot("pivot-a")],
      teammates: [teammate("t2", "pivot-a", "2026-10-06T02:00:00.000Z")],
      decisions: [decision("d1")],
    });
    state = applyPivotStreamEvent(state, {
      _tag: "changed",
      pivots: [],
      teammates: [teammate("t1", "pivot-a", "2026-10-06T01:00:00.000Z")],
      decisions: [decision("d1", true), decision("d2")],
    });
    expect(teammatesOfPivot(state, ThreadId.make("pivot-a")).map((t) => t.threadId)).toEqual([
      "t1",
      "t2",
    ]);
    expect(Object.keys(state.decisions)).toEqual(["d2"]);
    expect(Object.keys(state.pivots)).toEqual(["pivot-a"]);
  });

  it("summarizes what a takeover would move", () => {
    const state = applyPivotStreamEvent(EMPTY_PIVOT_STATE, {
      _tag: "snapshot",
      pivots: [pivot("pivot-old", "2026-10-05T00:00:00.000Z"), pivot("pivot-a")],
      teammates: [
        teammate("live", "pivot-a", "2026-10-06T01:00:00.000Z"),
        teammate("gone", "pivot-a", "2026-10-06T00:00:00.000Z", "2026-10-06T03:00:00.000Z"),
      ],
      decisions: [],
    });
    expect(takeoverSummary(state, projectId)).toMatchObject({
      pivot: { threadId: "pivot-a" },
      liveTeammates: 1,
      openDecisions: 1,
    });
    expect(takeoverSummary(state, ProjectId.make("elsewhere"))).toBeNull();
  });
});
