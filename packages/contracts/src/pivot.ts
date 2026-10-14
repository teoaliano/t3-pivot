import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { TeammateModelEntry } from "./settings.ts";

/**
 * A ship delivers a change; a scout investigates and leaves a report. An inline task
 * delivers a small change from the Pivot's own workspace: no worktree, setup run or dev
 * server of its own, one at a time per project.
 */
export const TeammateKind = Schema.Literals(["ship", "scout", "inline"]);
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
  /**
   * For a merge or landing: branches in the order they merge, so the user approves the
   * order with the merge. Every unmerged PR of the Pivot's has to be in it.
   */
  mergeOrder: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
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
  /**
   * Why its agent has not started yet while the machine is short of memory, such as
   * "Waiting for memory: agents use 9.7 of 9.4 GB". Null or absent when it is not waiting.
   */
  memoryWait: Schema.optional(Schema.NullOr(Schema.String)),
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
  /** The thread id a New Pivot draft reserved, so its first send lands on the Pivot. */
  threadId: Schema.optional(ThreadId),
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

export const PivotDecisionLogInput = Schema.Struct({ pivotThreadId: ThreadId });
export type PivotDecisionLogInput = typeof PivotDecisionLogInput.Type;

/** Every decision a Pivot owns, newest first, so the user can audit its own answers. */
export const PivotDecisionLog = Schema.Struct({ decisions: Schema.Array(PivotDecision) });
export type PivotDecisionLog = typeof PivotDecisionLog.Type;

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

// --- Pivot host ------------------------------------------------------------------------
//
// What this environment exposes so another environment's Pivot (its home) can run
// teammates here. Every method needs the `pivot:host` scope, and every request names the
// home's environment ID, which the host binds to the host link on its first call.

/** Limits on what a host link's session may send, so one request cannot be made unbounded. */
export const PIVOT_HOST_TITLE_MAX_LENGTH = 200;
export const PIVOT_HOST_LABEL_MAX_LENGTH = 200;
export const PIVOT_HOST_DISPATCH_ID_MAX_LENGTH = 128;
export const PIVOT_HOST_TEXT_MAX_LENGTH = 100_000;
export const PIVOT_HOST_REF_MAX_LENGTH = 255;

// A branch the host launches from. It reaches `git`, so it must look like a ref name: never
// an option (a leading "-"), and none of the sequences git refuses in one.
const PLAUSIBLE_REF_PATTERN =
  /^(?![-/])(?!.*\.\.)(?!.*\/\/)(?!.*(?:^|\/)\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[A-Za-z0-9._/-]+$/;
export const PivotHostBranchName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PIVOT_HOST_REF_MAX_LENGTH),
  Schema.isPattern(PLAUSIBLE_REF_PATTERN),
);

/** Fields every `pivotHost.*` request carries. */
const PivotHostCall = { homeEnvironmentId: EnvironmentId };

/** Why a host refused, so the home can tell a revoked link from a request it got wrong. */
export const PivotHostErrorReason = Schema.Literals([
  "not-authorized",
  "revoked",
  "home-mismatch",
  "project-not-allowed",
  "worktree-not-clean",
  "teammate-not-found",
  "refused",
  "failed",
]);
export type PivotHostErrorReason = typeof PivotHostErrorReason.Type;

export class PivotHostError extends Schema.TaggedError<PivotHostError>()("PivotHostError", {
  reason: PivotHostErrorReason,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const PivotHostDescribeInput = Schema.Struct({ ...PivotHostCall });
export type PivotHostDescribeInput = typeof PivotHostDescribeInput.Type;

/** A project on the host link's allowlist, as the home matches it to its own. */
export const PivotHostProject = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  /** `repositoryGroupingKeyOf` the project's repository identity; null when it has none. */
  repositoryKey: Schema.NullOr(TrimmedNonEmptyString),
  hasRemote: Schema.Boolean,
  /** The project's teammate models from the host's own Settings. */
  teammateModels: Schema.Array(TeammateModelEntry),
});
export type PivotHostProject = typeof PivotHostProject.Type;

export const PivotHostDescription = Schema.Struct({
  projects: Schema.Array(PivotHostProject),
  /** The host's own teammate models, before any project overrides them. */
  teammateModels: Schema.Array(TeammateModelEntry),
});
export type PivotHostDescription = typeof PivotHostDescription.Type;

export const PivotHostLaunchInput = Schema.Struct({
  ...PivotHostCall,
  /** The home's idempotency key: a retried launch returns the same teammate. */
  dispatchId: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_DISPATCH_ID_MAX_LENGTH)),
  projectId: ProjectId,
  /** The Pivot's thread on the home; it sends the teammate its messages. */
  pivotThreadId: ThreadId,
  /** What people on the host read as the sender, such as "Pivot on Mac". */
  pivotLabel: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_LABEL_MAX_LENGTH)),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_TITLE_MAX_LENGTH)),
  kind: TeammateKind,
  intent: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_TEXT_MAX_LENGTH)),
  spec: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_TEXT_MAX_LENGTH)),
  baseBranch: Schema.optional(PivotHostBranchName),
  modelSelection: ModelSelection,
});
export type PivotHostLaunchInput = typeof PivotHostLaunchInput.Type;

export const PivotHostLaunchResult = Schema.Struct({
  threadId: ThreadId,
  branch: Schema.String,
  baseBranch: Schema.String,
  worktreePath: Schema.String,
  deliveryMode: PivotDeliveryMode,
  runId: Schema.NullOr(RunId),
  firstRun: Schema.Literals(["started", "failed"]),
  detail: Schema.NullOr(Schema.String),
  setupScript: Schema.Literals(["none", "running", "succeeded", "failed"]),
  setupDetail: Schema.NullOr(Schema.String),
});
export type PivotHostLaunchResult = typeof PivotHostLaunchResult.Type;

/** A request about one hosted teammate. */
export const PivotHostTeammateInput = Schema.Struct({ ...PivotHostCall, threadId: ThreadId });
export type PivotHostTeammateInput = typeof PivotHostTeammateInput.Type;

export const PivotHostSendInput = Schema.Struct({
  ...PivotHostCall,
  threadId: ThreadId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_TEXT_MAX_LENGTH)),
});
export type PivotHostSendInput = typeof PivotHostSendInput.Type;

export const PivotHostRunStart = Schema.Struct({
  outcome: Schema.Literals(["started", "failed"]),
  runId: Schema.NullOr(RunId),
  detail: Schema.NullOr(Schema.String),
});
export type PivotHostRunStart = typeof PivotHostRunStart.Type;

export const PivotHostTeardownInput = Schema.Struct({
  ...PivotHostCall,
  threadId: ThreadId,
  /** Remove the worktree even with uncommitted changes. The home decides, on the user's word. */
  force: Schema.Boolean,
});
export type PivotHostTeardownInput = typeof PivotHostTeardownInput.Type;

/** A pull request of the teammate's own: the host resolves the project from the teammate. */
export const PivotHostPullRequestInput = Schema.Struct({
  ...PivotHostCall,
  threadId: ThreadId,
  host: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_REF_MAX_LENGTH))),
  repository: TrimmedNonEmptyString.check(Schema.isMaxLength(PIVOT_HOST_REF_MAX_LENGTH)),
  number: PositiveInt,
});
export type PivotHostPullRequestInput = typeof PivotHostPullRequestInput.Type;

export const PivotHostMergeInput = Schema.Struct({
  ...PivotHostPullRequestInput.fields,
  /** The merge is pinned to this head. */
  expectedHeadSha: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type PivotHostMergeInput = typeof PivotHostMergeInput.Type;

export const PivotHostLandResult = Schema.Union([
  Schema.TaggedStruct("landed", { head: Schema.String, defaultBranch: Schema.String }),
  Schema.TaggedStruct("refused", { reason: Schema.String }),
]);
export type PivotHostLandResult = typeof PivotHostLandResult.Type;

export const PivotHostEventsInput = Schema.Struct({
  ...PivotHostCall,
  /** Entries with a greater sequence; 0 replays the whole log. */
  afterSequence: NonNegativeInt,
});
export type PivotHostEventsInput = typeof PivotHostEventsInput.Type;

/** What the host's log records about a hosted teammate, for the home to apply. */
export const PivotHostEventBody = Schema.Union([
  /** An accepted `report_status`. */
  Schema.TaggedStruct("reported", {
    status: TeammateReportedStatus,
    summary: TrimmedNonEmptyString,
    until: Schema.NullOr(IsoDateTime),
    runId: Schema.NullOr(RunId),
    decisionKey: Schema.NullOr(TrimmedNonEmptyString),
    clearedDecision: Schema.NullOr(
      Schema.Struct({
        key: Schema.NullOr(TrimmedNonEmptyString),
        resolution: TrimmedNonEmptyString,
      }),
    ),
  }),
  Schema.TaggedStruct("scout-report-recorded", { report: TrimmedNonEmptyString }),
  /** The thread did something; the home's stuck bound reads the time. */
  Schema.TaggedStruct("activity", {}),
  /** The user typed into the thread directly on the host. */
  Schema.TaggedStruct("user-message", { text: Schema.String }),
  /** The user answered an approval or question the thread's run was held on. */
  Schema.TaggedStruct("request-answered", { answer: Schema.String }),
]);
export type PivotHostEventBody = typeof PivotHostEventBody.Type;

export const PivotHostEvent = Schema.Struct({
  /** Increases with every entry the host appends, across all its teammates. */
  sequence: PositiveInt,
  threadId: ThreadId,
  at: IsoDateTime,
  event: PivotHostEventBody,
});
export type PivotHostEvent = typeof PivotHostEvent.Type;
