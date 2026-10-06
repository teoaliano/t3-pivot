/**
 * The events in Pivot mode's own log (`pivot.sqlite`). They never reach V2's
 * database, so T3 Code never has to decode them.
 *
 * @module PivotEvents
 */
import {
  IsoDateTime,
  MessageId,
  PivotDecisionEscalation,
  PivotDecisionId,
  PivotDeliveryMode,
  ProjectId,
  RunId,
  TeammateKind,
  TeammateReport,
  TeammateResumeState,
  TeammateStatus,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const event = <const Type extends string, const Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) => Schema.Struct({ type: Schema.Literal(type), ...fields });

export const DeliveryChange = Schema.Literals(["merged", "closed", "checks-failed"]);
export type DeliveryChange = typeof DeliveryChange.Type;

export const PivotEvent = Schema.Union([
  event("pivot.created", {
    threadId: ThreadId,
    projectId: ProjectId,
    homePath: Schema.String,
    predecessorThreadId: Schema.NullOr(ThreadId),
  }),
  event("pivot.retired", { threadId: ThreadId, successorThreadId: ThreadId }),
  /** A wake went out, covering the Pivot's pending events through `throughSequence`. */
  event("pivot.woke", {
    threadId: ThreadId,
    messageId: MessageId,
    /** Where the wake's content starts: a wake that joins a queued one starts where it did. */
    fromSequence: Schema.Number,
    throughSequence: Schema.Number,
  }),
  event("teammate.dispatched", {
    threadId: ThreadId,
    pivotThreadId: ThreadId,
    projectId: ProjectId,
    kind: TeammateKind,
    title: Schema.String,
    branch: Schema.String,
    baseBranch: Schema.String,
    worktreePath: Schema.String,
    deliveryMode: PivotDeliveryMode,
    intent: Schema.String,
    spec: Schema.String,
  }),
  event("teammate.promoted", { threadId: ThreadId, spec: Schema.String }),
  event("teammate.intent-added", { threadId: ThreadId, text: Schema.String }),
  event("teammate.reported", { threadId: ThreadId, report: TeammateReport }),
  event("teammate.scout-report-recorded", { threadId: ThreadId, report: Schema.String }),
  event("teammate.resume-changed", {
    threadId: ThreadId,
    resume: Schema.NullOr(TeammateResumeState),
  }),
  /** The supervisor saw the combined status change. */
  event("teammate.status-observed", {
    threadId: ThreadId,
    status: TeammateStatus,
    previousStatus: Schema.NullOr(TeammateStatus),
    runId: Schema.NullOr(RunId),
    detail: Schema.NullOr(Schema.String),
    /** For `paused`: when the wait should clear, if known. The recheck lands then. */
    pausedUntil: Schema.NullOr(IsoDateTime),
  }),
  /** The Pivot stopped the teammate; what that run does next is the Pivot's own doing. */
  event("teammate.stopped", { threadId: ThreadId, runId: Schema.NullOr(RunId) }),
  event("teammate.relaunched", { threadId: ThreadId }),
  event("teammate.stuck", { threadId: ThreadId, runId: RunId }),
  event("teammate.pause-rechecked", { threadId: ThreadId, nextRecheckAt: IsoDateTime }),
  event("teammate.user-message", { threadId: ThreadId, text: Schema.String }),
  /** An approval or question its run was held on got answered; V2 does not say by whom. */
  event("teammate.request-answered", { threadId: ThreadId, answer: Schema.String }),
  event("teammate.delivery-changed", {
    threadId: ThreadId,
    url: Schema.String,
    change: DeliveryChange,
  }),
  /** The Pivot merged the teammate's PR, so its sync reading merged is not news. */
  event("teammate.merge-requested", { threadId: ThreadId, url: Schema.NullOr(Schema.String) }),
  event("teammate.landed", { threadId: ThreadId, head: Schema.String }),
  event("teammate.torn-down", { threadId: ThreadId }),
  event("decision.opened", {
    decisionId: PivotDecisionId,
    pivotThreadId: ThreadId,
    teammateThreadId: Schema.NullOr(ThreadId),
    key: Schema.String,
    openedBy: Schema.Literals(["teammate", "pivot"]),
    summary: Schema.String,
  }),
  event("decision.escalated", {
    decisionId: PivotDecisionId,
    escalation: PivotDecisionEscalation,
  }),
  event("decision.user-answered", {
    decisionId: PivotDecisionId,
    answer: Schema.String,
    /** For a decision asking for approval: whether the user approved. */
    approved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  }),
  event("decision.closed", {
    decisionId: PivotDecisionId,
    kind: Schema.Literals(["answered", "cleared", "moot"]),
    text: Schema.String,
  }),
]);
export type PivotEvent = typeof PivotEvent.Type;
export type PivotEventType = PivotEvent["type"];

export interface StoredPivotEvent {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly wakes: boolean;
  readonly event: PivotEvent;
}
