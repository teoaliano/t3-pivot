import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  PivotDecision,
  PivotDecisionEscalation,
  PivotDecisionId,
  PivotDeliveryMode,
  TeammateKind,
  TeammateReportedStatus,
  TeammateStatus,
} from "./pivot.ts";

// --- Pivot tools ---------------------------------------------------------------------

export const PivotMcpDispatchTeammateInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  kind: TeammateKind,
  /** The user's words, verbatim, with no speaker label. */
  intent: TrimmedNonEmptyString,
  /** The Pivot's build instructions. */
  spec: TrimmedNonEmptyString,
  /** Stack on another branch instead of the origin's default branch. */
  baseBranch: Schema.optional(TrimmedNonEmptyString),
  /** Defaults to the project's default model, then the Pivot's own. */
  modelSelection: Schema.optional(ModelSelection),
});
export type PivotMcpDispatchTeammateInput = typeof PivotMcpDispatchTeammateInput.Type;

export const PivotMcpDispatchTeammateResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  kind: TeammateKind,
  branch: Schema.String,
  baseBranch: Schema.String,
  worktreePath: Schema.String,
  deliveryMode: PivotDeliveryMode,
  /** `failed` when setup failed; retry with relaunch_teammate or tear it down. */
  firstRun: Schema.Literals(["started", "failed"]),
  detail: Schema.NullOr(Schema.String),
});
export type PivotMcpDispatchTeammateResult = typeof PivotMcpDispatchTeammateResult.Type;

export const PivotMcpTeammateTarget = Schema.Struct({ threadId: ThreadId });
export type PivotMcpTeammateTarget = typeof PivotMcpTeammateTarget.Type;

export const PivotMcpPromoteScoutInput = Schema.Struct({
  threadId: ThreadId,
  spec: TrimmedNonEmptyString,
});
export type PivotMcpPromoteScoutInput = typeof PivotMcpPromoteScoutInput.Type;

export const PivotMcpAddIntentInput = Schema.Struct({
  threadId: ThreadId,
  /** The user's new words, verbatim. */
  intent: TrimmedNonEmptyString,
  /** The Pivot's own instructions that go with them. */
  text: Schema.optional(Schema.String),
});
export type PivotMcpAddIntentInput = typeof PivotMcpAddIntentInput.Type;

export const PivotMcpTeammateResult = Schema.Struct({
  threadId: ThreadId,
  kind: TeammateKind,
  intent: Schema.Array(Schema.String),
});
export type PivotMcpTeammateResult = typeof PivotMcpTeammateResult.Type;

export const PivotMcpOpenDecisionInput = Schema.Struct({
  /** The teammate it is about; omit for a decision of the Pivot's own. */
  teammateThreadId: Schema.optional(ThreadId),
  key: Schema.optional(TrimmedNonEmptyString),
  question: TrimmedNonEmptyString,
});
export type PivotMcpOpenDecisionInput = typeof PivotMcpOpenDecisionInput.Type;

export const PivotMcpEscalateDecisionInput = Schema.Struct({
  decisionId: PivotDecisionId,
  ...PivotDecisionEscalation.fields,
});
export type PivotMcpEscalateDecisionInput = typeof PivotMcpEscalateDecisionInput.Type;

export const PivotMcpAnswerDecisionInput = Schema.Struct({
  decisionId: PivotDecisionId,
  answer: TrimmedNonEmptyString,
});
export type PivotMcpAnswerDecisionInput = typeof PivotMcpAnswerDecisionInput.Type;

export const PivotMcpMarkDecisionMootInput = Schema.Struct({
  decisionId: PivotDecisionId,
  evidence: TrimmedNonEmptyString,
});
export type PivotMcpMarkDecisionMootInput = typeof PivotMcpMarkDecisionMootInput.Type;

export const PivotMcpDecisionResult = Schema.Struct({ decision: PivotDecision });
export type PivotMcpDecisionResult = typeof PivotMcpDecisionResult.Type;

export const PivotMcpListTeammatesInput = Schema.Struct({
  includeTornDown: Schema.optional(Schema.Boolean),
});
export type PivotMcpListTeammatesInput = typeof PivotMcpListTeammatesInput.Type;

/** One teammate, the way firstmate's crew-state line reads. */
export const PivotMcpTeammateLine = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  kind: TeammateKind,
  status: TeammateStatus,
  summary: Schema.NullOr(Schema.String),
  branch: Schema.String,
  pullRequestUrl: Schema.NullOr(Schema.String),
  lastChangeAt: Schema.NullOr(IsoDateTime),
  worktreePath: Schema.String,
  tornDown: Schema.Boolean,
});
export type PivotMcpTeammateLine = typeof PivotMcpTeammateLine.Type;

export const PivotMcpListTeammatesResult = Schema.Struct({
  teammates: Schema.Array(PivotMcpTeammateLine),
});
export type PivotMcpListTeammatesResult = typeof PivotMcpListTeammatesResult.Type;

export const PIVOT_HISTORY_DEFAULT_LIMIT = 20;
export const PIVOT_HISTORY_MAX_LIMIT = 100;

export const PivotMcpTeammateHistoryInput = Schema.Struct({
  threadId: ThreadId,
  /** Page back from here: the `nextBeforeSequence` of the previous page. */
  beforeSequence: Schema.optional(PositiveInt),
  limit: Schema.optional(PositiveInt),
});
export type PivotMcpTeammateHistoryInput = typeof PivotMcpTeammateHistoryInput.Type;

export const PivotMcpTeammateHistoryResult = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({ sequence: PositiveInt, at: IsoDateTime, line: Schema.String }),
  ),
  /** Null once the oldest entry is on this page. */
  nextBeforeSequence: Schema.NullOr(PositiveInt),
});
export type PivotMcpTeammateHistoryResult = typeof PivotMcpTeammateHistoryResult.Type;

export const PivotMcpControlResult = Schema.Struct({
  threadId: ThreadId,
  outcome: Schema.Literals(["stopped", "relaunched", "relaunch-failed"]),
  detail: Schema.NullOr(Schema.String),
});
export type PivotMcpControlResult = typeof PivotMcpControlResult.Type;

export const PivotMcpMergeTeammateInput = Schema.Struct({
  threadId: ThreadId,
  /** The "PR ready" decision the user approved. */
  decisionId: PivotDecisionId,
  /** Checks the user explicitly waived by name. */
  waivedChecks: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type PivotMcpMergeTeammateInput = typeof PivotMcpMergeTeammateInput.Type;

export const PivotMcpMergeTeammateResult = Schema.Struct({
  threadId: ThreadId,
  url: Schema.String,
  mergedHead: Schema.String,
});
export type PivotMcpMergeTeammateResult = typeof PivotMcpMergeTeammateResult.Type;

export const PivotMcpLandTeammateInput = Schema.Struct({
  threadId: ThreadId,
  /** The "branch ready" decision the user approved. */
  decisionId: PivotDecisionId,
});
export type PivotMcpLandTeammateInput = typeof PivotMcpLandTeammateInput.Type;

export const PivotMcpLandTeammateResult = Schema.Struct({
  threadId: ThreadId,
  branch: Schema.String,
  defaultBranch: Schema.String,
  landedHead: Schema.String,
});
export type PivotMcpLandTeammateResult = typeof PivotMcpLandTeammateResult.Type;

export const PivotMcpTeardownTeammateInput = Schema.Struct({
  threadId: ThreadId,
  /** For unlanded work only: the decision whose user answer says to discard it. */
  discardDecisionId: Schema.optional(PivotDecisionId),
});
export type PivotMcpTeardownTeammateInput = typeof PivotMcpTeardownTeammateInput.Type;

export const PivotMcpTeardownTeammateResult = Schema.Struct({
  threadId: ThreadId,
  /** Why the work counted as landed, or that the user said to discard it. */
  reason: Schema.String,
  branch: Schema.String,
});
export type PivotMcpTeardownTeammateResult = typeof PivotMcpTeardownTeammateResult.Type;

// --- Teammate tools ------------------------------------------------------------------

export const PivotMcpReportStatusInput = Schema.Struct({
  status: TeammateReportedStatus,
  /** The phase line for `working`, otherwise one short line. */
  summary: TrimmedNonEmptyString,
  /** Only for `paused`: when the wait should clear. */
  until: Schema.optional(IsoDateTime),
  /** Names the decision a `needs-decision` or `blocked` report raises. */
  decisionKey: Schema.optional(TrimmedNonEmptyString),
  /** Closes your own blocker that cleared before anyone answered it. */
  clearDecision: Schema.optional(
    Schema.Struct({
      key: Schema.optional(TrimmedNonEmptyString),
      resolution: TrimmedNonEmptyString,
    }),
  ),
});
export type PivotMcpReportStatusInput = typeof PivotMcpReportStatusInput.Type;

export const PivotMcpReportStatusResult = Schema.Struct({
  status: TeammateReportedStatus,
  openDecisions: NonNegativeInt,
});
export type PivotMcpReportStatusResult = typeof PivotMcpReportStatusResult.Type;

export const PivotMcpRecordScoutReportInput = Schema.Struct({
  report: TrimmedNonEmptyString,
});
export type PivotMcpRecordScoutReportInput = typeof PivotMcpRecordScoutReportInput.Type;

export const PivotMcpRecordScoutReportResult = Schema.Struct({ recorded: Schema.Boolean });
export type PivotMcpRecordScoutReportResult = typeof PivotMcpRecordScoutReportResult.Type;
