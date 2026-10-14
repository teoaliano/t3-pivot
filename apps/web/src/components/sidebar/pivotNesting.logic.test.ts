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
  nestPivotTeammates,
  pivotGroupHasTeammates,
  pivotSidebarStatus,
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

  it("keeps a Pivot's teammates out of the sidebar list, while search still finds them", () => {
    const threads = ["active", "first", "second", "plain"].map(row);
    const nesting = nestPivotTeammates(threads, () => state);
    expect(nesting.topLevel.map((thread) => thread.id)).toEqual(["active", "plain"]);
    expect(nesting.teammatesByPivotKey.get("env-1:active")?.map((thread) => thread.id)).toEqual([
      "first",
      "second",
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
      settled: false,
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
        merged: teammate("merged", "active", "2026-10-05T02:00:00.000Z"),
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
          : threadId === "merged"
            ? { ...running, status: "idle" as const, settled: true }
            : running;
    const group = sidebarPivotGroup(withNeeds, ThreadId.make("active"), shellOf);
    // Torn-down and settled (merged) teammates leave the list, as settled threads do.
    expect(group?.teammates.map((card) => card.threadId)).toEqual(["first", "second", "third"]);
    // Two teammates need the user, plus the Pivot's own held decision.
    expect(group?.needYou).toBe(3);
    expect(group?.retired).toBe(false);
    // A takeover moves every live teammate, so a retired Pivot lists none.
    const afterTakeover: PivotState = {
      ...state,
      teammates: {
        ...state.teammates,
        finished: { ...state.teammates.finished!, tornDownAt: "2026-10-05T00:00:00.000Z" },
      },
    };
    const retired = sidebarPivotGroup(afterTakeover, ThreadId.make("retired"), () => null);
    expect(retired).toMatchObject({ retired: true, teammates: [], needYou: 0 });
    // So the retired row reads "Retired" with no zero count, as an empty active Pivot shows none.
    expect(pivotGroupHasTeammates(retired!)).toBe(false);
    expect(pivotGroupHasTeammates({ retired: false, teammates: [], needYou: 0 })).toBe(false);
    expect(pivotGroupHasTeammates(group!)).toBe(true);
    // A decision the Pivot holds for the user still shows, with no teammates.
    expect(pivotGroupHasTeammates({ retired: false, teammates: [], needYou: 1 })).toBe(true);
    expect(sidebarPivotGroup(state, ThreadId.make("first"), () => null)).toBeNull();
  });

  it("gives a Pivot's row the status of its teammates, with its own status as the fallback", () => {
    const shell = (overrides: Partial<TeammateCardShell>): TeammateCardShell => ({
      title: "",
      providerInstanceId: "codex",
      status: "idle",
      latestRunId: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      lastError: null,
      usageLimitResetAt: null,
      latestRunStartedAt: null,
      latestRunCompletedAt: null,
      pullRequest: null,
      settled: false,
      ...overrides,
    });
    const pivotThreadId = ThreadId.make("active");
    const statusOf = (
      shellOf: (threadId: ThreadId) => TeammateCardShell | null,
      pivotState: PivotState = state,
    ) => pivotSidebarStatus("ready", sidebarPivotGroup(pivotState, pivotThreadId, shellOf));

    // A teammate working while the Pivot itself is idle: the row reads Working.
    const working = shell({ status: "running" });
    expect(statusOf((id) => (id === "first" ? working : null))).toBe("working");

    // A teammate waiting on an approval outranks the working one beside it.
    const waiting = shell({
      status: "running",
      pendingRuntimeRequest: { kind: "approval" } as never,
    });
    expect(statusOf((id) => (id === "first" ? working : id === "second" ? waiting : null))).toBe(
      "approval",
    );

    // A decision a teammate escalated to the user reads as Input.
    const escalated = {
      ...state,
      teammates: {
        ...state.teammates,
        first: { ...state.teammates.first!, hasEscalatedDecision: true },
      },
    };
    expect(statusOf(() => null, escalated)).toBe("input");

    // Nothing running or waiting: the Pivot keeps its own status.
    expect(statusOf(() => null)).toBe("ready");
    expect(pivotSidebarStatus("working", null)).toBe("working");
  });

  it("teammate threads notify only when a question or approval holds them", () => {
    const first = ThreadId.make("first");
    expect(threadNotifiesUser(first, state, "ready")).toBe(false);
    expect(threadNotifiesUser(first, state, "failed")).toBe(false);
    expect(threadNotifiesUser(first, state, "input")).toBe(true);
    expect(threadNotifiesUser(first, state, "approval")).toBe(true);
    expect(threadNotifiesUser(ThreadId.make("active"), state, "ready")).toBe(true);
    expect(threadNotifiesUser(ThreadId.make("plain"), state, "failed")).toBe(true);
    expect(threadNotifiesUser(first, null, "ready")).toBe(true);
  });
});
