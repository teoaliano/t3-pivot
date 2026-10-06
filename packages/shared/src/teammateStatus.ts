import { TEAMMATE_TERMINAL_REPORTED_STATUSES } from "@t3tools/contracts";
import type {
  OrchestrationV2ShellThreadStatus,
  OrchestrationV2ThreadShell,
  TeammateReportedStatus,
  TeammateStatus,
  TeammateRecord,
} from "@t3tools/contracts";

import { backgroundWorkHoldsCompletion } from "./orchestrationV2PendingBackgroundWork.ts";

const TERMINAL: ReadonlySet<TeammateReportedStatus> = new Set(TEAMMATE_TERMINAL_REPORTED_STATUSES);

const ACTIVE_RUN: ReadonlySet<OrchestrationV2ShellThreadStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export interface TeammateStatusInput extends Pick<
  OrchestrationV2ThreadShell,
  | "status"
  | "latestRunId"
  | "pendingRuntimeRequest"
  | "pendingBackgroundTasks"
  | "lastError"
  | "lastErrorClass"
> {
  readonly teammate: Pick<TeammateRecord, "report" | "resume">;
}

export interface TeammateStatusResult {
  readonly status: TeammateStatus;
  /** The report summary, or the run's error when a terminal report stands over it. */
  readonly detail: string | null;
}

/**
 * Combines a teammate's latest report with its V2 thread shell. Runtime wins
 * while the teammate is active; once idle, only a report made in the latest
 * run counts, so a silent follow-up run never reads as a stale `done`.
 *
 * A `working` report is a phase line, not an outcome: once idle it is ignored
 * (the teammate stopped without reporting) and only kept as the detail.
 */
export function deriveTeammateStatus(input: TeammateStatusInput): TeammateStatusResult {
  const { resume } = input.teammate;
  const report =
    input.latestRunId !== null && input.teammate.report?.runId === input.latestRunId
      ? input.teammate.report
      : null;

  if (input.pendingRuntimeRequest !== null) {
    return { status: "waiting", detail: null };
  }

  const active =
    resume === "pending" ||
    ACTIVE_RUN.has(input.status) ||
    // Dev servers and other commands left running do not count; subagents and monitors do.
    backgroundWorkHoldsCompletion(input.pendingBackgroundTasks ?? []) ||
    // A teammate that has not run yet is about to: dispatch starts the first run.
    (input.latestRunId === null && resume !== "failed");
  if (active) {
    return { status: "working", detail: report?.status === "working" ? report.summary : null };
  }

  const failed = resume === "failed" || input.status === "failed";
  const error = failed ? (input.lastError ?? null) : null;

  // A terminal report stands over a later failure in the same run; the error is the detail.
  if (report && TERMINAL.has(report.status)) {
    return { status: report.status, detail: error ?? report.summary };
  }
  // V2's limit recovery resumes the run once the limit resets, so it is a wait.
  if (resume !== "failed" && input.status === "failed" && input.lastErrorClass === "usage_limit") {
    return { status: "paused", detail: error };
  }
  if (failed) {
    return { status: "failed", detail: error };
  }
  if (report?.status === "paused") {
    return { status: "paused", detail: report.summary };
  }
  return { status: "unreported", detail: report?.summary ?? null };
}
