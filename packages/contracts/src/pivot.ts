import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** A ship delivers a change; a scout investigates and leaves a report. */
export const TeammateKind = Schema.Literals(["ship", "scout"]);
export type TeammateKind = typeof TeammateKind.Type;

/** What a teammate can say about its latest run through `report_status`. */
export const TeammateReportedStatus = Schema.Literals([
  "working",
  "needs-decision",
  "blocked",
  "paused",
  "done",
  "failed",
]);
export type TeammateReportedStatus = typeof TeammateReportedStatus.Type;

/** Reports that end a run's story. `working` and `paused` do not. */
export const TEAMMATE_TERMINAL_REPORTED_STATUSES = [
  "needs-decision",
  "blocked",
  "done",
  "failed",
] as const satisfies ReadonlyArray<TeammateReportedStatus>;

/**
 * What a teammate is doing as the user and the Pivot see it: the reported
 * status combined with runtime evidence. Derived, never stored.
 */
export const TeammateStatus = Schema.Literals([
  "working",
  "waiting",
  "needs-decision",
  "blocked",
  "paused",
  "done",
  "failed",
  "unreported",
]);
export type TeammateStatus = typeof TeammateStatus.Type;

/** A report is scoped to the run it was made in, so a later silent run never reads stale. */
export const TeammateReport = Schema.Struct({
  status: TeammateReportedStatus,
  runId: Schema.NullOr(RunId),
  /** The phase line for `working`, otherwise a one-line summary. */
  summary: Schema.NullOr(TrimmedNonEmptyString),
  /** Only for `paused`: when the external wait should clear. */
  until: Schema.optional(Schema.NullOr(IsoDateTime)),
  reportedAt: IsoDateTime,
});
export type TeammateReport = typeof TeammateReport.Type;

/**
 * Set by the server when a restart interrupted the teammate's run: `pending`
 * while T3 resumes it, `failed` if the resume failed. Null otherwise.
 */
export const TeammateResumeState = Schema.Literals(["pending", "failed"]);
export type TeammateResumeState = typeof TeammateResumeState.Type;

/** Shell value of a Pivot thread. Set at creation and never cleared. */
export const ThreadPivot = Schema.Struct({
  retiredAt: Schema.NullOr(IsoDateTime),
  /** The Pivot that took over when this one was retired. */
  successorThreadId: Schema.NullOr(ThreadId),
  /** Open decisions held for the user, for the sidebar badge. */
  escalatedDecisionCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type ThreadPivot = typeof ThreadPivot.Type;

/** Shell value of a teammate thread. Set once by dispatch; the owner moves only on takeover. */
export const ThreadTeammate = Schema.Struct({
  pivotThreadId: ThreadId,
  kind: TeammateKind,
  /** Latest report with the run it was made in. Null until the first report. */
  report: Schema.NullOr(TeammateReport),
  resume: Schema.optional(Schema.NullOr(TeammateResumeState)),
  /** Whether an open decision linked to this teammate is held for the user. */
  hasEscalatedDecision: Schema.optional(Schema.Boolean),
  /** Order among the Pivot's teammates, so cards keep dispatch order. */
  dispatchedAt: IsoDateTime,
});
export type ThreadTeammate = typeof ThreadTeammate.Type;

/** A project with a remote delivers PRs; one without delivers ready branches. */
export const PivotDeliveryMode = Schema.Literals(["direct-pr", "local-only"]);
export type PivotDeliveryMode = typeof PivotDeliveryMode.Type;
