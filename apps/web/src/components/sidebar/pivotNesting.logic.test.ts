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
    // The running one is working; the torn-down and the settled one are retired, not done.
    expect(group?.working).toBe(1);
    expect(group?.done).toBe(0);
    expect(group?.retired).toBe(false);
    // A takeover moves every live teammate and tears them down: the retired Pivot has
    // nothing left to count.
    const afterTakeover: PivotState = {
      ...state,
      teammates: {
        ...state.teammates,
        finished: { ...state.teammates.finished!, tornDownAt: "2026-10-05T00:00:00.000Z" },
      },
    };
    const retired = sidebarPivotGroup(afterTakeover, ThreadId.make("retired"), () => null);
    expect(retired).toMatchObject({
      retired: true,
      teammates: [],
      needYou: 0,
      working: 0,
      done: 0,
    });
    const nothing = { retired: false, teammates: [], needYou: 0, working: 0, done: 0 };
    expect(pivotGroupHasTeammates(nothing)).toBe(false);
    expect(pivotGroupHasTeammates(group!)).toBe(true);
    // A decision the Pivot holds for the user still shows, with no teammates.
    expect(pivotGroupHasTeammates({ ...nothing, needYou: 1 })).toBe(true);
    expect(sidebarPivotGroup(state, ThreadId.make("first"), () => null)).toBeNull();
  });

  it("counts a Pivot's teammates by the state their icon shows", () => {
    const T = "2026-10-06T01:00:00.000Z";
    const shell = (overrides: Partial<TeammateCardShell>): TeammateCardShell => ({
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
      ...overrides,
    });
    const counted = (
      teammates: Record<string, TeammateRecord>,
      shellOf: (threadId: ThreadId) => TeammateCardShell | null = () => null,
      decisions: PivotState["decisions"] = {},
    ) =>
      sidebarPivotGroup(
        { pivots: { active: pivot("active") }, teammates, decisions },
        ThreadId.make("active"),
        shellOf,
      );

    // A running teammate is working.
    expect(counted({ w: teammate("w", "active", T) }, () => shell({}))).toMatchObject({
      working: 1,
      needYou: 0,
      done: 0,
    });

    // A teammate waiting on an approval and one holding a decision both need the user.
    const approval = shell({ pendingRuntimeRequest: { kind: "approval" } as never });
    expect(
      counted(
        {
          a: teammate("a", "active", T),
          e: { ...teammate("e", "active", T), hasEscalatedDecision: true },
        },
        (threadId) => (threadId === "a" ? approval : shell({})),
      ),
    ).toMatchObject({ needYou: 2, working: 0, done: 0 });

    // A finished teammate still in view is done; torn-down and settled ones are retired.
    expect(
      counted(
        {
          t: { ...teammate("t", "active", T), tornDownAt: "2026-10-05T01:00:00.000Z" },
          s: teammate("s", "active", T),
          d: { ...teammate("d", "active", T), report: { status: "done", runId: "run" } as never },
        },
        (threadId) =>
          shell({ status: "idle", latestRunId: "run" as never, settled: threadId !== "d" }),
      ),
    ).toMatchObject({ done: 1, working: 0, needYou: 0 });

    // Only the Pivot's own decisions count toward its own need; a teammate's do not.
    const decision = (decisionId: string, teammateThreadId: string | null) =>
      ({
        decisionId,
        openedAt: T,
        pivotThreadId: ThreadId.make("active"),
        teammateThreadId: teammateThreadId === null ? null : ThreadId.make(teammateThreadId),
      }) as never;
    expect(
      counted({}, undefined, {
        own: decision("own", null),
        held: decision("held", "w"),
      }),
    ).toMatchObject({ needYou: 1 });
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
