import { ProjectId, RunId, type TeammateRecord, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  elapsedLabel,
  type TeammateCardShell,
  teammateCard,
  teammateCards,
} from "./pivotCards.logic";

const teammate = (overrides: Partial<TeammateRecord> = {}): TeammateRecord => ({
  threadId: ThreadId.make("t1"),
  pivotThreadId: ThreadId.make("pivot"),
  projectId: ProjectId.make("project"),
  kind: "ship",
  title: "Fix login",
  branch: "pivot/fix-login",
  report: null,
  resume: null,
  hasEscalatedDecision: false,
  hasScoutReport: false,
  dispatchedAt: "2026-10-06T10:00:00.000Z",
  tornDownAt: null,
  ...overrides,
});

const shell = (overrides: Partial<TeammateCardShell> = {}): TeammateCardShell => ({
  title: "Fix login on Safari",
  providerInstanceId: "codex",
  status: "running",
  latestRunId: RunId.make("run-1"),
  pendingRuntimeRequest: null,
  pendingBackgroundTasks: [],
  lastError: null,
  lastErrorClass: null,
  latestRunStartedAt: "2026-10-06T10:01:00.000Z",
  latestRunCompletedAt: null,
  pullRequest: null,
  ...overrides,
});

const report = (status: "done" | "blocked" | "working", at: string) => ({
  status,
  runId: RunId.make("run-1"),
  summary: `${status} summary`,
  until: null,
  reportedAt: at,
});

describe("teammate cards", () => {
  it("labels a running teammate and times it from its run", () => {
    const card = teammateCard(teammate(), shell());
    expect(card).toMatchObject({
      title: "Fix login on Safari",
      status: "working",
      label: "Working",
      attention: false,
      since: "2026-10-06T10:01:00.000Z",
      footer: null,
      providerInstanceId: "codex",
    });
  });

  it("gives attention statuses and escalated decisions an accent, and reads the latter as needs you", () => {
    const blocked = teammateCard(
      teammate({ report: report("blocked", "2026-10-06T10:30:00.000Z") }),
      shell({ status: "idle" }),
    );
    expect(blocked).toMatchObject({
      label: "Blocked",
      attention: true,
      since: "2026-10-06T10:30:00.000Z",
    });
    expect(teammateCard(teammate(), shell({ status: "idle" }))).toMatchObject({
      label: "Stopped",
      attention: true,
    });
    expect(
      teammateCard(teammate(), shell({ pendingRuntimeRequest: { kind: "approval" } as never })),
    ).toMatchObject({ label: "Waiting on approval", attention: true });
    expect(teammateCard(teammate({ hasEscalatedDecision: true }), shell())).toMatchObject({
      status: "working",
      label: "Needs you",
      attention: true,
    });
    expect(teammateCard(teammate({ report: report("working", "x") }), shell()).attention).toBe(
      false,
    );
  });

  it("shows the PR number for a ship and Scout for a scout", () => {
    const pr = { number: 42, url: "https://github.com/o/r/pull/42" };
    expect(teammateCard(teammate(), shell({ pullRequest: pr })).footer).toEqual({
      kind: "pull-request",
      ...pr,
    });
    expect(teammateCard(teammate({ kind: "scout" }), shell({ pullRequest: pr })).footer).toEqual({
      kind: "scout",
    });
  });

  it("keeps dispatch order and folds finished teammates behind the chip", () => {
    const done = teammate({
      threadId: ThreadId.make("done"),
      report: report("done", "2026-10-06T11:00:00.000Z"),
    });
    const tornDown = teammate({
      threadId: ThreadId.make("gone"),
      tornDownAt: "2026-10-06T12:00:00.000Z",
    });
    const doneButAsking = teammate({
      threadId: ThreadId.make("asking"),
      report: report("done", "2026-10-06T11:00:00.000Z"),
      hasEscalatedDecision: true,
    });
    const running = teammate({ threadId: ThreadId.make("running") });
    const cards = teammateCards([done, running, tornDown, doneButAsking], (id) =>
      id === "running" ? shell() : shell({ status: "idle" }),
    );
    expect(cards.live.map((card) => card.threadId)).toEqual(["running", "asking"]);
    expect(cards.finished.map((card) => card.threadId)).toEqual(["done", "gone"]);
  });

  it("reads elapsed time to the minute", () => {
    const now = Date.parse("2026-10-06T12:00:00.000Z");
    expect(elapsedLabel("2026-10-06T11:59:30.000Z", now)).toBe("now");
    expect(elapsedLabel("2026-10-06T11:15:00.000Z", now)).toBe("45m");
    expect(elapsedLabel("2026-10-06T09:00:00.000Z", now)).toBe("3h");
    expect(elapsedLabel("2026-10-03T12:00:00.000Z", now)).toBe("3d");
    expect(elapsedLabel(null, now)).toBeNull();
  });
});
