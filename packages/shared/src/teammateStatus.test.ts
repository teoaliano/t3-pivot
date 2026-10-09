import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  RunId,
  RuntimeRequestId,
  type OrchestrationV2PendingBackgroundTask,
  type OrchestrationV2PendingRuntimeRequestSummary,
  type TeammateReport,
  type TeammateStatus,
} from "@t3tools/contracts";

import { deriveTeammateStatus, type TeammateStatusInput } from "./teammateStatus.ts";

const report = (
  status: TeammateReport["status"],
  runId: string | null,
  summary: string | null = null,
): TeammateReport => ({
  status,
  runId: runId === null ? null : RunId.make(runId),
  summary: summary as TeammateReport["summary"],
  reportedAt: "2026-10-01T10:00:00.000Z" as TeammateReport["reportedAt"],
});

const request = (
  kind: OrchestrationV2PendingRuntimeRequestSummary["kind"],
): OrchestrationV2PendingRuntimeRequestSummary => ({
  id: RuntimeRequestId.make("request-1"),
  kind,
  createdAt: DateTime.makeUnsafe("2026-10-01T10:00:00.000Z"),
});

const background = (
  kind: OrchestrationV2PendingBackgroundTask["kind"],
): ReadonlyArray<OrchestrationV2PendingBackgroundTask> => [{ taskId: "task-1", kind }];

/** An idle teammate whose latest run, `run-2`, completed. */
const input = (
  overrides: Partial<Omit<TeammateStatusInput, "teammate">> & {
    report?: TeammateReport | null;
    resume?: "pending" | "failed" | null;
  } = {},
): TeammateStatusInput => {
  const { report: reported = null, resume = null, ...shell } = overrides;
  return {
    status: "completed",
    latestRunId: RunId.make("run-2"),
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    lastError: null,
    usageLimitResetAt: null,
    ...shell,
    teammate: { report: reported, resume },
  };
};

const failedRun = (lastError: string | null) => ({ status: "failed", lastError }) as const;

/** A run stopped by a usage limit that V2 will resume at the reset. */
const limitedRun = (lastError: string | null) =>
  ({ status: "failed", lastError, usageLimitResetAt: "2026-10-01T15:00:00.000Z" }) as const;

type Row = readonly [
  name: string,
  input: TeammateStatusInput,
  status: TeammateStatus,
  detail: string | null,
];

describe("deriveTeammateStatus", () => {
  const rows: ReadonlyArray<Row> = [
    // 1. A pending approval or question is waiting, over everything.
    [
      "pending approval while running",
      input({ pendingRuntimeRequest: request("command"), status: "running" }),
      "waiting",
      null,
    ],
    [
      "pending question while idle",
      input({ pendingRuntimeRequest: request("user_input") }),
      "waiting",
      null,
    ],
    [
      "pending approval over a done report",
      input({
        pendingRuntimeRequest: request("command"),
        report: report("done", "run-2", "shipped"),
      }),
      "waiting",
      null,
    ],
    [
      "pending approval over a pending resume",
      input({ pendingRuntimeRequest: request("command"), resume: "pending" }),
      "waiting",
      null,
    ],

    // 2. An active run or background work is working, whatever was reported.
    [
      "running run after an earlier done",
      input({ status: "running", report: report("done", "run-1", "shipped") }),
      "working",
      null,
    ],
    [
      "running run reports its phase line",
      input({ status: "running", report: report("working", "run-2", "Running tests") }),
      "working",
      "Running tests",
    ],
    [
      "running run over a done report in the same run",
      input({ status: "running", report: report("done", "run-2", "shipped") }),
      "working",
      null,
    ],
    ["preparing first run", input({ status: "preparing" }), "working", null],
    ["queued run", input({ status: "queued" }), "working", null],
    ["starting run", input({ status: "starting" }), "working", null],
    [
      "subagent still running after the run",
      input({
        pendingBackgroundTasks: background("subagent"),
        report: report("done", "run-2", "shipped"),
      }),
      "working",
      null,
    ],
    [
      "monitor still running after the run",
      input({
        pendingBackgroundTasks: background("monitor"),
        report: report("done", "run-2", "shipped"),
      }),
      "working",
      null,
    ],
    [
      "background work over a failed run",
      input({
        ...failedRun("boom"),
        pendingBackgroundTasks: background("subagent"),
      }),
      "working",
      null,
    ],
    [
      "a dev server left running is not work",
      input({
        pendingBackgroundTasks: background("command"),
        report: report("done", "run-2", "PR opened"),
      }),
      "done",
      "PR opened",
    ],

    // Never ran yet: dispatch is about to start the first run.
    ["no run yet", input({ status: "idle", latestRunId: null }), "working", null],

    // 4. Idle: the terminal report from the latest run counts.
    [
      "done in the latest run",
      input({ report: report("done", "run-2", "PR opened") }),
      "done",
      "PR opened",
    ],
    [
      "needs-decision in the latest run",
      input({ report: report("needs-decision", "run-2", "Which API?") }),
      "needs-decision",
      "Which API?",
    ],
    [
      "blocked in the latest run",
      input({ report: report("blocked", "run-2", "No credentials") }),
      "blocked",
      "No credentials",
    ],
    [
      "failed in the latest run",
      input({ report: report("failed", "run-2", "Tests red") }),
      "failed",
      "Tests red",
    ],
    [
      "paused in the latest run",
      input({ report: report("paused", "run-2", "Waiting on CI") }),
      "paused",
      "Waiting on CI",
    ],

    // A working report is not terminal: once idle it counts as no report.
    [
      "working report once idle",
      input({ report: report("working", "run-2", "Running tests") }),
      "unreported",
      "Running tests",
    ],
    [
      "working report once idle after a failure",
      input({
        ...failedRun("crashed"),
        report: report("working", "run-2", "Running tests"),
      }),
      "failed",
      "crashed",
    ],

    // 5. Idle with no terminal report in the latest run.
    ["no report at all", input(), "unreported", null],
    ["run failed, no report", input(failedRun("provider crashed")), "failed", "provider crashed"],
    ["run failed without error text", input({ status: "failed", lastError: null }), "failed", null],
    [
      "launch failed while preparing the worktree",
      input({ ...failedRun("setup failed"), latestRunId: RunId.make("run-1") }),
      "failed",
      "setup failed",
    ],
    ["interrupted run, no report", input({ status: "interrupted" }), "unreported", null],
    ["cancelled run, no report", input({ status: "cancelled" }), "unreported", null],
    [
      "paused report with a later failure",
      input({
        ...failedRun("crashed"),
        report: report("paused", "run-2", "Waiting on CI"),
      }),
      "failed",
      "crashed",
    ],

    // 3. A run stopped by a usage limit is paused until the reset, over any report.
    [
      "run stopped by a usage limit",
      input(limitedRun("Usage limit reached")),
      "paused",
      "Usage limit reached",
    ],
    [
      "usage limit after a done in the same run",
      input({
        ...limitedRun("Usage limit reached"),
        report: report("done", "run-2", "PR opened"),
      }),
      "paused",
      "Usage limit reached",
    ],
    [
      "usage limit after a blocked in the same run",
      input({
        ...limitedRun("Usage limit reached"),
        report: report("blocked", "run-2", "No credentials"),
      }),
      "paused",
      "Usage limit reached",
    ],
    [
      "usage limit with no reset time is a failure",
      input(failedRun("Usage limit reached")),
      "failed",
      "Usage limit reached",
    ],
    [
      "usage limit after a failed resume",
      input({ ...limitedRun("Usage limit reached"), resume: "failed" }),
      "failed",
      "Usage limit reached",
    ],

    // Reports are scoped to their run.
    [
      "stale done from an earlier run",
      input({ report: report("done", "run-1", "shipped") }),
      "unreported",
      null,
    ],
    [
      "stale done from an earlier run, then a failure",
      input({
        ...failedRun("crashed"),
        report: report("done", "run-1", "shipped"),
      }),
      "failed",
      "crashed",
    ],
    [
      "stale paused from an earlier run",
      input({ report: report("paused", "run-1", "Waiting on CI") }),
      "unreported",
      null,
    ],
    ["report with no run", input({ report: report("done", null, "shipped") }), "unreported", null],

    // 6. A terminal report stands over a later failure; the error is the detail.
    [
      "done over a failed run",
      input({
        ...failedRun("provider crashed"),
        report: report("done", "run-2", "PR opened"),
      }),
      "done",
      "provider crashed",
    ],
    [
      "blocked over a failed run",
      input({
        ...failedRun("provider crashed"),
        report: report("blocked", "run-2", "No credentials"),
      }),
      "blocked",
      "provider crashed",
    ],
    [
      "done over a failed run without error text",
      input({
        status: "failed",
        lastError: null,
        report: report("done", "run-2", "PR opened"),
      }),
      "done",
      "PR opened",
    ],

    // Restart: a pending resume is working, a failed resume is failed.
    [
      "resume pending over an interrupted run",
      input({ resume: "pending", status: "interrupted" }),
      "working",
      null,
    ],
    [
      "resume pending over a stale done",
      input({
        resume: "pending",
        status: "interrupted",
        report: report("done", "run-1", "shipped"),
      }),
      "working",
      null,
    ],
    [
      "resume pending over a done in the latest run",
      input({
        resume: "pending",
        status: "interrupted",
        report: report("done", "run-2", "shipped"),
      }),
      "working",
      null,
    ],
    [
      "resume failed, no report",
      input({ resume: "failed", status: "interrupted" }),
      "failed",
      null,
    ],
    [
      "resume failed, stale done",
      input({
        resume: "failed",
        status: "interrupted",
        report: report("done", "run-1", "shipped"),
      }),
      "failed",
      null,
    ],
    [
      "resume failed, done in the latest run",
      input({
        resume: "failed",
        status: "interrupted",
        report: report("done", "run-2", "shipped"),
      }),
      "done",
      "shipped",
    ],
    [
      "resume failed with no run",
      input({ resume: "failed", status: "idle", latestRunId: null }),
      "failed",
      null,
    ],
  ];

  it.each(rows)("%s", (_name, given, status, detail) => {
    expect(deriveTeammateStatus(given)).toEqual({ status, detail });
  });
});
