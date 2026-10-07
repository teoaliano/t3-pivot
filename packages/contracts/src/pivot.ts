import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

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

/** A project with a remote delivers PRs; one without delivers ready branches. */
export const PivotDeliveryMode = Schema.Literals(["direct-pr", "local-only"]);
export type PivotDeliveryMode = typeof PivotDeliveryMode.Type;

export const PivotDecisionId = TrimmedNonEmptyString.pipe(Schema.brand("PivotDecisionId"));
export type PivotDecisionId = typeof PivotDecisionId.Type;

/** What the Pivot hands the user when a decision needs their authority. */
export const PivotDecisionEscalation = Schema.Struct({
  questions: Schema.NonEmptyArray(TrimmedNonEmptyString),
  evidence: TrimmedNonEmptyString,
  consequence: TrimmedNonEmptyString,
  options: Schema.Array(TrimmedNonEmptyString),
  recommendation: TrimmedNonEmptyString,
  /**
   * Asks the user to approve or decline, as merging, landing or discarding needs; the
   * answer records which, alongside their words.
   */
  asksApproval: Schema.optional(Schema.Boolean),
});
export type PivotDecisionEscalation = typeof PivotDecisionEscalation.Type;

/** The user's words, kept exactly as typed: never trimmed, never only whitespace. */
const VerbatimText = Schema.String.check(Schema.isPattern(/\S/));

/** How a closed decision was closed. Only the Pivot's answer carries the user's words. */
export const PivotDecisionResolution = Schema.Struct({
  kind: Schema.Literals(["answered", "cleared", "moot"]),
  /** The answer the Pivot sent, how the blocker cleared, or the evidence it is moot. */
  text: TrimmedNonEmptyString,
  closedAt: IsoDateTime,
});
export type PivotDecisionResolution = typeof PivotDecisionResolution.Type;

/** A question that stops work until someone answers it. Owned by a Pivot. */
export const PivotDecision = Schema.Struct({
  decisionId: PivotDecisionId,
  pivotThreadId: ThreadId,
  teammateThreadId: Schema.NullOr(ThreadId),
  key: TrimmedNonEmptyString,
  openedBy: Schema.Literals(["teammate", "pivot"]),
  /** What was asked when the decision opened. */
  summary: TrimmedNonEmptyString,
  openedAt: IsoDateTime,
  /** Set once the Pivot holds the decision for the user. */
  escalation: Schema.NullOr(PivotDecisionEscalation),
  escalatedAt: Schema.NullOr(IsoDateTime),
  /** The user's answer, verbatim. */
  userAnswer: Schema.NullOr(VerbatimText),
  userAnsweredAt: Schema.NullOr(IsoDateTime),
  /** For a decision asking for approval: whether the user approved. Null otherwise. */
  userApproved: Schema.NullOr(Schema.Boolean),
  resolution: Schema.NullOr(PivotDecisionResolution),
});
export type PivotDecision = typeof PivotDecision.Type;

/** A Pivot's record in Pivot mode's own store. Never deleted. */
export const PivotRecord = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  createdAt: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
  /** The Pivot that took over when this one was retired. */
  successorThreadId: Schema.NullOr(ThreadId),
  openDecisionCount: NonNegativeInt,
  /** Open decisions held for the user, for the sidebar badge. */
  escalatedDecisionCount: NonNegativeInt,
});
export type PivotRecord = typeof PivotRecord.Type;

/** A teammate's record in Pivot mode's own store. The owner moves only on takeover. */
export const TeammateRecord = Schema.Struct({
  threadId: ThreadId,
  pivotThreadId: ThreadId,
  projectId: ProjectId,
  kind: TeammateKind,
  title: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  /** Latest report with the run it was made in. Null until the first report. */
  report: Schema.NullOr(TeammateReport),
  resume: Schema.NullOr(TeammateResumeState),
  /** Whether an open decision linked to this teammate is held for the user. */
  hasEscalatedDecision: Schema.Boolean,
  hasScoutReport: Schema.Boolean,
  /** Order among the Pivot's teammates, so cards keep dispatch order. */
  dispatchedAt: IsoDateTime,
  tornDownAt: Schema.NullOr(IsoDateTime),
});
export type TeammateRecord = typeof TeammateRecord.Type;

/**
 * The Pivot stream: a snapshot, then the records that changed. Clients join it
 * to V2 thread shells by thread id. Briefs never ride it; it goes to every client.
 */
export const PivotStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    pivots: Schema.Array(PivotRecord),
    teammates: Schema.Array(TeammateRecord),
    /** Open escalated decisions, for the decisions strip. */
    decisions: Schema.Array(PivotDecision),
  }),
  Schema.TaggedStruct("changed", {
    pivots: Schema.Array(PivotRecord),
    teammates: Schema.Array(TeammateRecord),
    /** Escalated decisions that changed, closed ones included so clients drop them. */
    decisions: Schema.Array(PivotDecision),
  }),
]);
export type PivotStreamEvent = typeof PivotStreamEvent.Type;

export const PivotSubscribeInput = Schema.Struct({});
export type PivotSubscribeInput = typeof PivotSubscribeInput.Type;

export const PivotCreateInput = Schema.Struct({
  projectId: ProjectId,
  modelSelection: ModelSelection,
  /** Required when the project has an active Pivot: the new one takes over its work. */
  takeover: Schema.Boolean,
});
export type PivotCreateInput = typeof PivotCreateInput.Type;

export const PivotCreateResult = Schema.Struct({
  threadId: ThreadId,
  /** The Pivot this one took over from, if any. */
  predecessorThreadId: Schema.NullOr(ThreadId),
});
export type PivotCreateResult = typeof PivotCreateResult.Type;

/** The user's answers are recorded verbatim, up to 8 KB. */
export const PIVOT_USER_ANSWER_MAX_BYTES = 8 * 1024;

export const PivotAnswerDecisionInput = Schema.Struct({
  decisionId: PivotDecisionId,
  answer: VerbatimText,
  /** Required for a decision that asks for approval. */
  approved: Schema.optional(Schema.Boolean),
});
export type PivotAnswerDecisionInput = typeof PivotAnswerDecisionInput.Type;

export const PivotAnswerDecisionResult = Schema.Struct({ decision: PivotDecision });
export type PivotAnswerDecisionResult = typeof PivotAnswerDecisionResult.Type;

export const PivotTeammateDetailInput = Schema.Struct({ threadId: ThreadId });
export type PivotTeammateDetailInput = typeof PivotTeammateDetailInput.Type;

/** A teammate's brief and scout report: detail only, never on the stream. */
export const PivotTeammateDetail = Schema.Struct({
  teammate: TeammateRecord,
  /** The user's words: the original intent, then every new ask, in order. */
  intent: Schema.Array(TrimmedNonEmptyString),
  spec: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  deliveryMode: PivotDeliveryMode,
  scoutReport: Schema.NullOr(Schema.String),
});
export type PivotTeammateDetail = typeof PivotTeammateDetail.Type;

export class PivotError extends Schema.TaggedError<PivotError>()("PivotError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
