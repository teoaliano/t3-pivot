import { type PivotState, EMPTY_PIVOT_STATE } from "@t3tools/client-runtime/pivot-state";
import {
  EnvironmentId,
  ProjectId,
  type PivotRecord,
  type TeammateRecord,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TeammateCardShell } from "../pivot/pivotCards.logic";

import {
  interleavePivotTeammates,
  nestPivotTeammates,
  sidebarPivotGroup,
  threadNotifiesUser,
} from "./pivotNesting.logic";

const env = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");
const row = (id: string) => ({ environmentId: env, id: ThreadId.make(id) });

const pivot = (id: string, retiredAt: string | null = null): PivotRecord => ({
  threadId: ThreadId.make(id),
  projectId,
  createdAt: "2026-10-06T00:00:00.000Z",
  retiredAt,
  successorThreadId: null,
  openDecisionCount: 2,
  escalatedDecisionCount: 1,
});
const teammate = (id: string, pivotId: string, dispatchedAt: string): TeammateRecord => ({
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
  dispatchedAt,
  tornDownAt: null,
});

const state: PivotState = {
  pivots: { active: pivot("active"), retired: pivot("retired", "2026-10-05T00:00:00.000Z") },
  teammates: {
    second: teammate("second", "active", "2026-10-06T02:00:00.000Z"),
    first: teammate("first", "active", "2026-10-06T01:00:00.000Z"),
    finished: teammate("finished", "retired", "2026-10-04T00:00:00.000Z"),
    orphan: teammate("orphan", "not-listed", "2026-10-06T00:00:00.000Z"),
  },
  decisions: {},
};

describe("Pivot nesting in the sidebar", () => {
  it("groups teammates under their Pivot in dispatch order, retired Pivots included", () => {
    const threads = ["active", "second", "plain", "first", "retired", "finished", "orphan"].map(
      row,
    );
    const nesting = nestPivotTeammates(threads, () => state);

    expect(nesting.topLevel.map((thread) => thread.id)).toEqual([
      "active",
      "plain",
      "retired",
      "orphan",
    ]);
    expect(nesting.teammatesByPivotKey.get("env-1:active")?.map((thread) => thread.id)).toEqual([
      "first",
      "second",
    ]);
    expect(nesting.teammatesByPivotKey.get("env-1:retired")?.map((thread) => thread.id)).toEqual([
      "finished",
    ]);
  });

  it("shows an expanded Pivot's teammates right after it", () => {
    const threads = ["active", "first", "second", "plain"].map(row);
    const nesting = nestPivotTeammates(threads, () => state);
    const collapsed = interleavePivotTeammates(
      nesting.topLevel,
      nesting.teammatesByPivotKey,
      new Set(),
    );
    expect(collapsed.map((entry) => entry.thread.id)).toEqual(["active", "plain"]);
    const expanded = interleavePivotTeammates(
      nesting.topLevel,
      nesting.teammatesByPivotKey,
      new Set(["env-1:active"]),
    );
    expect(expanded.map((entry) => [entry.thread.id, entry.nestedUnderKey])).toEqual([
      ["active", null],
      ["first", "env-1:active"],
      ["second", "env-1:active"],
      ["plain", null],
    ]);
  });

  it("leaves threads alone in an environment without Pivot mode", () => {
    const threads = ["active", "first"].map(row);
    expect(nestPivotTeammates(threads, () => null).topLevel).toHaveLength(2);
    expect(nestPivotTeammates(threads, () => EMPTY_PIVOT_STATE).topLevel).toHaveLength(2);
  });

  it("sums a Pivot up as its teammates and how many need the user", () => {
    const running: TeammateCardShell = {
      title: "",
      providerInstanceId: "codex",
      status: "running",
      latestRunId: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      lastError: null,
      usageLimitResetAt: null,
      latestRunStartedAt: null,
      latestRunCompletedAt: null,
      pullRequest: null,
    };
    const withNeeds: PivotState = {
      ...state,
      teammates: {
        ...state.teammates,
        // A decision held for the user, an approval waiting on the user, and a running one.
        first: { ...state.teammates.first!, hasEscalatedDecision: true },
        third: teammate("third", "active", "2026-10-06T03:00:00.000Z"),
        cleaned: {
          ...teammate("cleaned", "active", "2026-10-05T00:00:00.000Z"),
          tornDownAt: "2026-10-05T01:00:00.000Z",
        },
      },
      decisions: {
        own: {
          decisionId: "own",
          pivotThreadId: ThreadId.make("active"),
          teammateThreadId: null,
        } as never,
      },
    };
    const shellOf = (threadId: ThreadId) =>
      threadId === "second"
        ? { ...running, pendingRuntimeRequest: { kind: "approval" } as never }
        : threadId === "cleaned"
          ? null
          : running;
    const group = sidebarPivotGroup(withNeeds, ThreadId.make("active"), shellOf);
    expect(group?.live.map((card) => card.threadId)).toEqual(["first", "second", "third"]);
    expect(group?.finished.map((card) => card.threadId)).toEqual(["cleaned"]);
    // Two teammates need the user, plus the Pivot's own held decision.
    expect(group?.needYou).toBe(3);
    expect(group?.retired).toBe(false);
    // A retired Pivot keeps its finished teammates, read from the records.
    // A takeover moves every live teammate, so a retired Pivot only has cleaned-up ones.
    const afterTakeover: PivotState = {
      ...state,
      teammates: {
        ...state.teammates,
        finished: { ...state.teammates.finished!, tornDownAt: "2026-10-05T00:00:00.000Z" },
      },
    };
    const retired = sidebarPivotGroup(afterTakeover, ThreadId.make("retired"), () => null);
    expect(retired).toMatchObject({ retired: true, live: [], needYou: 0 });
    expect(retired?.finished.map((card) => card.threadId)).toEqual(["finished"]);
    expect(sidebarPivotGroup(state, ThreadId.make("first"), () => null)).toBeNull();
  });

  it("teammate threads produce no notifications", () => {
    expect(threadNotifiesUser(ThreadId.make("first"), state)).toBe(false);
    expect(threadNotifiesUser(ThreadId.make("active"), state)).toBe(true);
    expect(threadNotifiesUser(ThreadId.make("plain"), state)).toBe(true);
    expect(threadNotifiesUser(ThreadId.make("first"), null)).toBe(true);
  });
});
