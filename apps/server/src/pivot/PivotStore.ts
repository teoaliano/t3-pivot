/**
 * PivotStore - Pivot mode's records: Pivots, teammates, decisions, and each
 * Pivot's wake cursor, event-sourced in `pivot.sqlite`.
 *
 * Every write is a command. `dispatch` checks it against the current records,
 * appends its events and updates the projections in one transaction, then
 * publishes the changed records to the Pivot stream. A refused command writes
 * nothing. Records are keyed by V2 thread id; nothing here touches V2's database.
 *
 * @module PivotStore
 */
import {
  type IsoDateTime,
  type MessageId,
  PIVOT_USER_ANSWER_MAX_BYTES,
  type PivotDecision,
  type PivotDecisionEscalation,
  PivotDecisionEscalation as PivotDecisionEscalationSchema,
  PivotDecisionId,
  type PivotDeliveryMode,
  type PivotRecord,
  PivotDecisionResolution,
  type PivotStreamEvent,
  type ProjectId,
  type RunId,
  type TeammateKind,
  TeammateReport,
  type TeammateReportedStatus,
  type TeammateRecord,
  type TeammateResumeState,
  type TeammateStatus,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { randomUuidV4 } from "../orchestration-v2/RandomUuid.ts";
import { PivotSql } from "./PivotDatabase.ts";
import { type DeliveryChange, PivotEvent, type StoredPivotEvent } from "./PivotEvents.ts";

export class PivotRefusedError extends Schema.TaggedError<PivotRefusedError>()(
  "PivotRefusedError",
  { command: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export class PivotStoreError extends Schema.TaggedError<PivotStoreError>()("PivotStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Pivot store ${this.operation} failed.`;
  }
}

/** Statuses that wake the owning Pivot when a teammate reaches them. `working` and `paused` never do. */
export const WAKING_STATUSES: ReadonlySet<TeammateStatus> = new Set([
  "done",
  "needs-decision",
  "blocked",
  "failed",
  "unreported",
  "waiting",
]);

/** A `paused` teammate with no `until` is rechecked this often. */
export const PAUSED_RECHECK_MS = 4 * 60 * 60 * 1000;

const DEFAULT_DECISION_KEY = "default";

export type PivotCommand =
  | {
      readonly type: "pivot.create";
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly homePath: string;
      /** Without it, a project with an active Pivot refuses. */
      readonly takeover: boolean;
    }
  | {
      readonly type: "pivot.record-wake";
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
      readonly fromSequence: number;
      readonly throughSequence: number;
    }
  | {
      readonly type: "teammate.dispatch";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly kind: TeammateKind;
      readonly title: string;
      readonly branch: string;
      readonly baseBranch: string;
      /** Null when the launch produced no worktree, which refuses. */
      readonly worktreePath: string | null;
      readonly deliveryMode: PivotDeliveryMode;
      readonly intent: string;
      readonly spec: string;
    }
  | {
      readonly type: "teammate.promote";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
      readonly spec: string;
    }
  | {
      readonly type: "teammate.add-intent";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
      readonly text: string;
    }
  | {
      readonly type: "teammate.report";
      readonly threadId: ThreadId;
      readonly status: TeammateReportedStatus;
      readonly summary: string;
      readonly until: IsoDateTime | null;
      readonly runId: RunId | null;
      /** Opens or names the decision a `needs-decision` or `blocked` report raises. */
      readonly decisionKey: string | null;
      /** Closes the teammate's own open, never-escalated blocker: how it cleared. */
      readonly clearedDecision: { readonly key: string | null; readonly resolution: string } | null;
    }
  | {
      readonly type: "teammate.record-scout-report";
      readonly threadId: ThreadId;
      readonly report: string;
    }
  | {
      readonly type: "teammate.set-resume";
      readonly threadId: ThreadId;
      readonly resume: TeammateResumeState | null;
    }
  | {
      readonly type: "teammate.observe-status";
      readonly threadId: ThreadId;
      readonly status: TeammateStatus;
      readonly runId: RunId | null;
      readonly detail: string | null;
      /** For `paused`: when the wait should clear, if known. */
      readonly pausedUntil: IsoDateTime | null;
    }
  | {
      readonly type: "teammate.stop";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
      readonly runId: RunId | null;
    }
  | {
      readonly type: "teammate.relaunch";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
    }
  | { readonly type: "teammate.mark-stuck"; readonly threadId: ThreadId; readonly runId: RunId }
  | { readonly type: "teammate.recheck-paused"; readonly threadId: ThreadId }
  | {
      readonly type: "teammate.record-user-message";
      readonly threadId: ThreadId;
      readonly text: string;
    }
  | {
      readonly type: "teammate.record-delivery";
      readonly threadId: ThreadId;
      readonly url: string;
      readonly change: DeliveryChange;
    }
  | {
      readonly type: "teammate.tear-down";
      readonly pivotThreadId: ThreadId;
      readonly threadId: ThreadId;
    }
  | {
      readonly type: "decision.open";
      readonly pivotThreadId: ThreadId;
      readonly teammateThreadId: ThreadId | null;
      readonly key: string | null;
      readonly summary: string;
    }
  | {
      readonly type: "decision.escalate";
      readonly pivotThreadId: ThreadId;
      readonly decisionId: PivotDecisionId;
      readonly escalation: PivotDecisionEscalation;
    }
  | {
      readonly type: "decision.record-user-answer";
      readonly decisionId: PivotDecisionId;
      readonly answer: string;
    }
  | {
      readonly type: "decision.answer";
      readonly pivotThreadId: ThreadId;
      readonly decisionId: PivotDecisionId;
      readonly text: string;
    }
  | {
      readonly type: "decision.mark-moot";
      readonly pivotThreadId: ThreadId;
      readonly decisionId: PivotDecisionId;
      readonly evidence: string;
    };

/** A Pivot with what only the server needs. */
export interface PivotRow extends PivotRecord {
  readonly homePath: string;
  /** The Pivot-log sequence its last wake covered. */
  readonly wakeCursor: number;
  /** Where the last wake's content started, for a wake that joins it while it is queued. */
  readonly wakeFrom: number;
}

/** A teammate with its brief and the supervisor's bookkeeping. */
export interface TeammateRow extends TeammateRecord {
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly deliveryMode: PivotDeliveryMode;
  readonly intent: ReadonlyArray<string>;
  readonly spec: string;
  readonly scoutReport: string | null;
  readonly observedStatus: TeammateStatus | null;
  readonly observedRunId: RunId | null;
  readonly stuckRunId: RunId | null;
  readonly recheckAt: IsoDateTime | null;
}

export class PivotStore extends Context.Service<
  PivotStore,
  {
    /** Checks a command, then commits its events and projections; refuses with nothing written. */
    readonly dispatch: (
      command: PivotCommand,
    ) => Effect.Effect<ReadonlyArray<StoredPivotEvent>, PivotRefusedError | PivotStoreError>;
    readonly getPivot: (threadId: ThreadId) => Effect.Effect<PivotRow | null, PivotStoreError>;
    readonly getActivePivot: (
      projectId: ProjectId,
    ) => Effect.Effect<PivotRow | null, PivotStoreError>;
    readonly listActivePivots: Effect.Effect<ReadonlyArray<PivotRow>, PivotStoreError>;
    readonly getTeammate: (
      threadId: ThreadId,
    ) => Effect.Effect<TeammateRow | null, PivotStoreError>;
    /** In dispatch order. Torn-down teammates only when asked. */
    readonly listTeammates: (input: {
      readonly pivotThreadId?: ThreadId;
      readonly includeTornDown: boolean;
    }) => Effect.Effect<ReadonlyArray<TeammateRow>, PivotStoreError>;
    readonly getDecision: (
      decisionId: PivotDecisionId,
    ) => Effect.Effect<PivotDecision | null, PivotStoreError>;
    readonly listDecisions: (input: {
      readonly pivotThreadId: ThreadId;
      readonly openOnly: boolean;
    }) => Effect.Effect<ReadonlyArray<PivotDecision>, PivotStoreError>;
    /** A teammate's events, newest first: its reports, status changes and decisions. */
    readonly teammateHistory: (input: {
      readonly threadId: ThreadId;
      readonly beforeSequence?: number;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<StoredPivotEvent>, PivotStoreError>;
    /**
     * The events that should wake the Pivot, oldest first: after its wake cursor, or
     * after `afterSequence` when a wake still queued is being rebuilt.
     */
    readonly pendingWake: (
      pivotThreadId: ThreadId,
      afterSequence?: number,
    ) => Effect.Effect<ReadonlyArray<StoredPivotEvent>, PivotStoreError>;
    /** Snapshot, then changed records. */
    readonly stream: Stream.Stream<PivotStreamEvent, PivotStoreError>;
  }
>()("t3/pivot/PivotStore") {}

// --- Rows -------------------------------------------------------------------------------

interface PivotSqlRow {
  readonly thread_id: string;
  readonly project_id: string;
  readonly home_path: string;
  readonly created_at: string;
  readonly retired_at: string | null;
  readonly successor_thread_id: string | null;
  readonly wake_cursor: number;
  readonly wake_from: number;
  readonly open_decisions: number;
  readonly escalated_decisions: number;
}

interface TeammateSqlRow {
  readonly thread_id: string;
  readonly pivot_thread_id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly title: string;
  readonly branch: string;
  readonly base_branch: string;
  readonly worktree_path: string;
  readonly delivery_mode: string;
  readonly intent_json: string;
  readonly spec: string;
  readonly report_json: string | null;
  readonly resume: string | null;
  readonly scout_report: string | null;
  readonly dispatched_at: string;
  readonly torn_down_at: string | null;
  readonly observed_status: string | null;
  readonly observed_run_id: string | null;
  readonly stuck_run_id: string | null;
  readonly recheck_at: string | null;
  readonly escalated_decisions: number;
}

interface DecisionSqlRow {
  readonly decision_id: string;
  readonly pivot_thread_id: string;
  readonly teammate_thread_id: string | null;
  readonly key: string;
  readonly opened_by: string;
  readonly summary: string;
  readonly opened_at: string;
  readonly escalation_json: string | null;
  readonly escalated_at: string | null;
  readonly user_answer: string | null;
  readonly user_answered_at: string | null;
  readonly resolution_json: string | null;
  readonly closed_at: string | null;
}

interface EventSqlRow {
  readonly sequence: number;
  readonly occurred_at: string;
  readonly wakes: number;
  readonly payload_json: string;
}

const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(TeammateReport));
const decodeEscalation = Schema.decodeUnknownSync(
  Schema.fromJsonString(PivotDecisionEscalationSchema),
);
const decodeResolution = Schema.decodeUnknownSync(Schema.fromJsonString(PivotDecisionResolution));
const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(PivotEvent));
const encodeEvent = Schema.encodeSync(Schema.fromJsonString(PivotEvent));
const IntentJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeIntent = Schema.decodeUnknownSync(IntentJson);
const encodeIntent = Schema.encodeSync(IntentJson);
const encodeReport = Schema.encodeSync(Schema.fromJsonString(TeammateReport));
const encodeEscalation = Schema.encodeSync(Schema.fromJsonString(PivotDecisionEscalationSchema));
const encodeResolution = Schema.encodeSync(Schema.fromJsonString(PivotDecisionResolution));

// Rows are written only through this module, so ids read back carry their brands.
const toPivot = (row: PivotSqlRow): PivotRow => ({
  threadId: row.thread_id as ThreadId,
  projectId: row.project_id as ProjectId,
  createdAt: row.created_at,
  retiredAt: row.retired_at,
  successorThreadId: row.successor_thread_id as ThreadId | null,
  openDecisionCount: row.open_decisions,
  escalatedDecisionCount: row.escalated_decisions,
  homePath: row.home_path,
  wakeCursor: row.wake_cursor,
  wakeFrom: row.wake_from,
});

const toTeammate = (row: TeammateSqlRow): TeammateRow => ({
  threadId: row.thread_id as ThreadId,
  pivotThreadId: row.pivot_thread_id as ThreadId,
  projectId: row.project_id as ProjectId,
  kind: row.kind as TeammateKind,
  title: row.title,
  branch: row.branch,
  report: row.report_json === null ? null : decodeReport(row.report_json),
  resume: row.resume as TeammateResumeState | null,
  hasEscalatedDecision: row.escalated_decisions > 0,
  hasScoutReport: row.scout_report !== null,
  dispatchedAt: row.dispatched_at,
  tornDownAt: row.torn_down_at,
  baseBranch: row.base_branch,
  worktreePath: row.worktree_path,
  deliveryMode: row.delivery_mode as PivotDeliveryMode,
  intent: decodeIntent(row.intent_json),
  spec: row.spec,
  scoutReport: row.scout_report,
  observedStatus: row.observed_status as TeammateStatus | null,
  observedRunId: row.observed_run_id as RunId | null,
  stuckRunId: row.stuck_run_id as RunId | null,
  recheckAt: row.recheck_at,
});

const toDecision = (row: DecisionSqlRow): PivotDecision => ({
  decisionId: row.decision_id as PivotDecisionId,
  pivotThreadId: row.pivot_thread_id as ThreadId,
  teammateThreadId: row.teammate_thread_id as ThreadId | null,
  key: row.key,
  openedBy: row.opened_by as PivotDecision["openedBy"],
  summary: row.summary,
  openedAt: row.opened_at,
  escalation: row.escalation_json === null ? null : decodeEscalation(row.escalation_json),
  escalatedAt: row.escalated_at,
  userAnswer: row.user_answer,
  userAnsweredAt: row.user_answered_at,
  resolution: row.resolution_json === null ? null : decodeResolution(row.resolution_json),
});

const toStoredEvent = (row: EventSqlRow): StoredPivotEvent => ({
  sequence: row.sequence,
  occurredAt: row.occurred_at,
  wakes: row.wakes === 1,
  event: decodeEvent(row.payload_json),
});

/** Strips the server-only fields so a record can go to clients. */
export const pivotRecord = (row: PivotRow): PivotRecord => ({
  threadId: row.threadId,
  projectId: row.projectId,
  createdAt: row.createdAt,
  retiredAt: row.retiredAt,
  successorThreadId: row.successorThreadId,
  openDecisionCount: row.openDecisionCount,
  escalatedDecisionCount: row.escalatedDecisionCount,
});

export const teammateRecord = (row: TeammateRow): TeammateRecord => ({
  threadId: row.threadId,
  pivotThreadId: row.pivotThreadId,
  projectId: row.projectId,
  kind: row.kind,
  title: row.title,
  branch: row.branch,
  report: row.report,
  resume: row.resume,
  hasEscalatedDecision: row.hasEscalatedDecision,
  hasScoutReport: row.hasScoutReport,
  dispatchedAt: row.dispatchedAt,
  tornDownAt: row.tornDownAt,
});

const byteLength = (text: string) => new TextEncoder().encode(text).length;

// --- Service ----------------------------------------------------------------------------

export const make = Effect.gen(function* () {
  const sql = yield* PivotSql;
  // One writer at a time, and publishes leave in commit order.
  const writeLock = yield* Semaphore.make(1);
  const changes = yield* PubSub.unbounded<Extract<PivotStreamEvent, { _tag: "changed" }>>();

  const storeError = (operation: string) => (cause: unknown) =>
    new PivotStoreError({ operation, cause });

  // --- Reads ---

  const pivotSelect = sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM pivot_decisions d
        WHERE d.pivot_thread_id = p.thread_id AND d.closed_at IS NULL) AS open_decisions,
      (SELECT COUNT(*) FROM pivot_decisions d
        WHERE d.pivot_thread_id = p.thread_id AND d.closed_at IS NULL
          AND d.escalated_at IS NOT NULL) AS escalated_decisions
    FROM pivot_pivots p
  `;
  const teammateSelect = sql`
    SELECT t.*,
      (SELECT COUNT(*) FROM pivot_decisions d
        WHERE d.teammate_thread_id = t.thread_id AND d.closed_at IS NULL
          AND d.escalated_at IS NOT NULL) AS escalated_decisions
    FROM pivot_teammates t
  `;

  const readPivot = (threadId: string) =>
    sql<PivotSqlRow>`${pivotSelect} WHERE p.thread_id = ${threadId}`.pipe(
      Effect.map((rows) => (rows[0] ? toPivot(rows[0]) : null)),
    );
  const readActivePivot = (projectId: string) =>
    sql<PivotSqlRow>`${pivotSelect} WHERE p.project_id = ${projectId} AND p.retired_at IS NULL`.pipe(
      Effect.map((rows) => (rows[0] ? toPivot(rows[0]) : null)),
    );
  const readTeammate = (threadId: string) =>
    sql<TeammateSqlRow>`${teammateSelect} WHERE t.thread_id = ${threadId}`.pipe(
      Effect.map((rows) => (rows[0] ? toTeammate(rows[0]) : null)),
    );
  const readDecision = (decisionId: string) =>
    sql<DecisionSqlRow>`SELECT * FROM pivot_decisions WHERE decision_id = ${decisionId}`.pipe(
      Effect.map((rows) => (rows[0] ? toDecision(rows[0]) : null)),
    );
  const readOpenDecision = (pivotThreadId: string, teammateThreadId: string | null, key: string) =>
    (teammateThreadId === null
      ? sql<DecisionSqlRow>`
          SELECT * FROM pivot_decisions
          WHERE pivot_thread_id = ${pivotThreadId} AND teammate_thread_id IS NULL
            AND key = ${key} AND closed_at IS NULL`
      : sql<DecisionSqlRow>`
          SELECT * FROM pivot_decisions
          WHERE teammate_thread_id = ${teammateThreadId} AND key = ${key} AND closed_at IS NULL`
    ).pipe(Effect.map((rows) => (rows[0] ? toDecision(rows[0]) : null)));

  // --- Deciding ---

  type Draft = { readonly event: PivotEvent; readonly wakes: boolean };

  const decide = Effect.fn("PivotStore.decide")(function* (command: PivotCommand, now: string) {
    const refuse = (reason: string) => new PivotRefusedError({ command: command.type, reason });

    // A teammate the caller may act on: its own, live. Retired Pivots act on nothing.
    const ownLiveTeammate = (pivotThreadId: ThreadId, threadId: ThreadId) =>
      Effect.gen(function* () {
        const pivot = yield* readPivot(pivotThreadId);
        if (pivot === null) return yield* refuse("Only a Pivot can do this.");
        if (pivot.retiredAt !== null) return yield* refuse("This Pivot is retired.");
        const teammate = yield* readTeammate(threadId);
        if (teammate === null || teammate.pivotThreadId !== pivotThreadId) {
          return yield* refuse(`Thread ${threadId} is not one of this Pivot's teammates.`);
        }
        if (teammate.tornDownAt !== null) {
          return yield* refuse(`Teammate ${threadId} was torn down.`);
        }
        return teammate;
      });
    const anyTeammate = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const teammate = yield* readTeammate(threadId);
        if (teammate === null) return yield* refuse(`Thread ${threadId} is not a teammate.`);
        return teammate;
      });
    const liveTeammate = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const teammate = yield* anyTeammate(threadId);
        if (teammate.tornDownAt !== null) {
          return yield* refuse(`Teammate ${threadId} was torn down.`);
        }
        return teammate;
      });
    const ownOpenDecision = (pivotThreadId: ThreadId, decisionId: PivotDecisionId) =>
      Effect.gen(function* () {
        const pivot = yield* readPivot(pivotThreadId);
        if (pivot === null) return yield* refuse("Only a Pivot can do this.");
        if (pivot.retiredAt !== null) return yield* refuse("This Pivot is retired.");
        const decision = yield* readDecision(decisionId);
        if (decision === null || decision.pivotThreadId !== pivotThreadId) {
          return yield* refuse(`Decision ${decisionId} is not one of this Pivot's decisions.`);
        }
        if (decision.resolution !== null) {
          return yield* refuse(`Decision ${decisionId} is already closed.`);
        }
        return decision;
      });
    const nonEmpty = (text: string, what: string) =>
      text.trim().length === 0 ? Effect.fail(refuse(`${what} is empty.`)) : Effect.succeed(text);
    const newDecisionId = randomUuidV4.pipe(
      Effect.map((uuid) => PivotDecisionId.make(`decision-${uuid}`)),
    );

    const drafts: Array<Draft> = [];
    const emit = (event: PivotEvent, wakes = false) => {
      drafts.push({ event, wakes });
    };

    switch (command.type) {
      case "pivot.create": {
        if ((yield* readPivot(command.threadId)) !== null) {
          return yield* refuse(`Thread ${command.threadId} is already a Pivot.`);
        }
        if ((yield* readTeammate(command.threadId)) !== null) {
          return yield* refuse(`Thread ${command.threadId} is a teammate.`);
        }
        const active = yield* readActivePivot(command.projectId);
        if (active !== null && !command.takeover) {
          return yield* refuse(
            "This project already has an active Pivot. Creating another takes over its work.",
          );
        }
        // Retire first: the one-active-Pivot index holds at every step.
        if (active !== null) {
          emit({
            type: "pivot.retired",
            threadId: active.threadId,
            successorThreadId: command.threadId,
          });
        }
        emit({
          type: "pivot.created",
          threadId: command.threadId,
          projectId: command.projectId,
          homePath: command.homePath,
          predecessorThreadId: active?.threadId ?? null,
        });
        break;
      }
      case "pivot.record-wake": {
        const pivot = yield* readPivot(command.threadId);
        if (pivot === null) return yield* refuse(`Thread ${command.threadId} is not a Pivot.`);
        if (command.throughSequence <= pivot.wakeCursor) break;
        emit({
          type: "pivot.woke",
          threadId: command.threadId,
          messageId: command.messageId,
          fromSequence: command.fromSequence,
          throughSequence: command.throughSequence,
        });
        break;
      }
      case "teammate.dispatch": {
        const pivot = yield* readPivot(command.pivotThreadId);
        if (pivot === null) return yield* refuse("Only a Pivot dispatches teammates.");
        if (pivot.retiredAt !== null) return yield* refuse("This Pivot is retired.");
        if (pivot.projectId !== command.projectId) {
          return yield* refuse("A Pivot dispatches teammates only in its own project.");
        }
        if (command.worktreePath === null) {
          return yield* refuse("A teammate needs its own worktree, and the launch produced none.");
        }
        if ((yield* readTeammate(command.threadId)) !== null) {
          return yield* refuse(`Thread ${command.threadId} is already a teammate.`);
        }
        if ((yield* readPivot(command.threadId)) !== null) {
          return yield* refuse(`Thread ${command.threadId} is a Pivot.`);
        }
        yield* nonEmpty(command.intent, "The intent");
        yield* nonEmpty(command.spec, "The spec");
        emit({
          type: "teammate.dispatched",
          threadId: command.threadId,
          pivotThreadId: command.pivotThreadId,
          projectId: command.projectId,
          kind: command.kind,
          title: command.title,
          branch: command.branch,
          baseBranch: command.baseBranch,
          worktreePath: command.worktreePath,
          deliveryMode: command.deliveryMode,
          intent: command.intent,
          spec: command.spec,
        });
        break;
      }
      case "teammate.promote": {
        const teammate = yield* ownLiveTeammate(command.pivotThreadId, command.threadId);
        if (teammate.kind !== "scout") return yield* refuse("Only a scout can be promoted.");
        yield* nonEmpty(command.spec, "The spec");
        emit({ type: "teammate.promoted", threadId: command.threadId, spec: command.spec });
        break;
      }
      case "teammate.add-intent": {
        yield* ownLiveTeammate(command.pivotThreadId, command.threadId);
        yield* nonEmpty(command.text, "The user's words");
        emit({ type: "teammate.intent-added", threadId: command.threadId, text: command.text });
        break;
      }
      case "teammate.report": {
        const teammate = yield* liveTeammate(command.threadId);
        yield* nonEmpty(command.summary, "The summary");
        if (command.until !== null && command.status !== "paused") {
          return yield* refuse("Only a `paused` report takes `until`.");
        }
        emit({
          type: "teammate.reported",
          threadId: command.threadId,
          report: {
            status: command.status,
            runId: command.runId,
            summary: command.summary,
            until: command.until,
            reportedAt: now,
          },
        });
        if (command.clearedDecision !== null) {
          const key = command.clearedDecision.key ?? DEFAULT_DECISION_KEY;
          const open = yield* readOpenDecision(teammate.pivotThreadId, teammate.threadId, key);
          if (open === null) return yield* refuse(`No open decision "${key}" to clear.`);
          if (open.escalatedAt !== null) {
            return yield* refuse("An escalated decision is closed by the Pivot's answer.");
          }
          yield* nonEmpty(command.clearedDecision.resolution, "How the blocker cleared");
          emit({
            type: "decision.closed",
            decisionId: open.decisionId,
            kind: "cleared",
            text: command.clearedDecision.resolution,
          });
        }
        if (command.status === "needs-decision" || command.status === "blocked") {
          const key = command.decisionKey ?? DEFAULT_DECISION_KEY;
          const open = yield* readOpenDecision(teammate.pivotThreadId, teammate.threadId, key);
          if (open === null) {
            emit({
              type: "decision.opened",
              decisionId: yield* newDecisionId,
              pivotThreadId: teammate.pivotThreadId,
              teammateThreadId: teammate.threadId,
              key,
              openedBy: "teammate",
              summary: command.summary,
            });
          }
        }
        break;
      }
      case "teammate.record-scout-report": {
        const teammate = yield* liveTeammate(command.threadId);
        if (teammate.kind !== "scout") return yield* refuse("Only a scout records a report.");
        yield* nonEmpty(command.report, "The report");
        emit({
          type: "teammate.scout-report-recorded",
          threadId: command.threadId,
          report: command.report,
        });
        break;
      }
      case "teammate.set-resume": {
        const teammate = yield* anyTeammate(command.threadId);
        if (teammate.resume === command.resume) break;
        // Resuming and failing to resume both belong in the post-restart digest.
        emit(
          { type: "teammate.resume-changed", threadId: command.threadId, resume: command.resume },
          command.resume !== null,
        );
        break;
      }
      case "teammate.observe-status": {
        const teammate = yield* anyTeammate(command.threadId);
        if (teammate.tornDownAt !== null) break;
        if (
          teammate.observedStatus === command.status &&
          teammate.observedRunId === command.runId
        ) {
          break;
        }
        // A status reached because the Pivot stopped the run is the Pivot's own doing.
        const stoppedByPivot = yield* sql<{ readonly stopped_run_id: string | null }>`
          SELECT stopped_run_id FROM pivot_teammates WHERE thread_id = ${command.threadId}
        `.pipe(Effect.map((rows) => rows[0]?.stopped_run_id === (command.runId ?? "")));
        const changed = teammate.observedStatus !== command.status;
        emit(
          {
            type: "teammate.status-observed",
            threadId: command.threadId,
            status: command.status,
            previousStatus: teammate.observedStatus,
            runId: command.runId,
            detail: command.detail,
            pausedUntil: command.status === "paused" ? command.pausedUntil : null,
          },
          changed && WAKING_STATUSES.has(command.status) && !stoppedByPivot,
        );
        break;
      }
      case "teammate.stop": {
        yield* ownLiveTeammate(command.pivotThreadId, command.threadId);
        emit({ type: "teammate.stopped", threadId: command.threadId, runId: command.runId });
        break;
      }
      case "teammate.relaunch": {
        yield* ownLiveTeammate(command.pivotThreadId, command.threadId);
        emit({ type: "teammate.relaunched", threadId: command.threadId });
        break;
      }
      case "teammate.mark-stuck": {
        const teammate = yield* liveTeammate(command.threadId);
        if (teammate.stuckRunId === command.runId) break;
        emit({ type: "teammate.stuck", threadId: command.threadId, runId: command.runId }, true);
        break;
      }
      case "teammate.recheck-paused": {
        const teammate = yield* liveTeammate(command.threadId);
        if (teammate.observedStatus !== "paused") break;
        const next = DateTime.formatIso(
          DateTime.add(DateTime.makeUnsafe(now), { milliseconds: PAUSED_RECHECK_MS }),
        );
        emit(
          { type: "teammate.pause-rechecked", threadId: command.threadId, nextRecheckAt: next },
          true,
        );
        break;
      }
      case "teammate.record-user-message": {
        yield* liveTeammate(command.threadId);
        yield* nonEmpty(command.text, "The message");
        emit(
          { type: "teammate.user-message", threadId: command.threadId, text: command.text },
          true,
        );
        break;
      }
      case "teammate.record-delivery": {
        yield* anyTeammate(command.threadId);
        emit(
          {
            type: "teammate.delivery-changed",
            threadId: command.threadId,
            url: command.url,
            change: command.change,
          },
          true,
        );
        break;
      }
      case "teammate.tear-down": {
        yield* ownLiveTeammate(command.pivotThreadId, command.threadId);
        emit({ type: "teammate.torn-down", threadId: command.threadId });
        break;
      }
      case "decision.open": {
        const pivot = yield* readPivot(command.pivotThreadId);
        if (pivot === null) return yield* refuse("Only a Pivot opens decisions.");
        if (pivot.retiredAt !== null) return yield* refuse("This Pivot is retired.");
        if (command.teammateThreadId !== null) {
          yield* ownLiveTeammate(command.pivotThreadId, command.teammateThreadId);
        }
        yield* nonEmpty(command.summary, "The question");
        const key = command.key ?? DEFAULT_DECISION_KEY;
        if (
          (yield* readOpenDecision(command.pivotThreadId, command.teammateThreadId, key)) !== null
        ) {
          return yield* refuse(`A decision "${key}" is already open there.`);
        }
        emit({
          type: "decision.opened",
          decisionId: yield* newDecisionId,
          pivotThreadId: command.pivotThreadId,
          teammateThreadId: command.teammateThreadId,
          key,
          openedBy: "pivot",
          summary: command.summary,
        });
        break;
      }
      case "decision.escalate": {
        const decision = yield* ownOpenDecision(command.pivotThreadId, command.decisionId);
        if (decision.userAnswer !== null) {
          return yield* refuse("The user already answered this decision.");
        }
        emit({
          type: "decision.escalated",
          decisionId: command.decisionId,
          escalation: command.escalation,
        });
        break;
      }
      case "decision.record-user-answer": {
        const decision = yield* readDecision(command.decisionId);
        if (decision === null)
          return yield* refuse(`Decision ${command.decisionId} was not found.`);
        if (decision.resolution !== null) return yield* refuse("This decision is already closed.");
        if (decision.escalatedAt === null) {
          return yield* refuse("This decision is with the Pivot, not held for you.");
        }
        if (decision.userAnswer !== null) {
          return yield* refuse("This decision already has your answer.");
        }
        yield* nonEmpty(command.answer, "The answer");
        if (byteLength(command.answer) > PIVOT_USER_ANSWER_MAX_BYTES) {
          return yield* refuse("The answer is longer than 8 KB.");
        }
        emit(
          {
            type: "decision.user-answered",
            decisionId: command.decisionId,
            answer: command.answer,
          },
          true,
        );
        break;
      }
      case "decision.answer": {
        const decision = yield* ownOpenDecision(command.pivotThreadId, command.decisionId);
        if (decision.escalatedAt !== null && decision.userAnswer === null) {
          return yield* refuse(
            "This decision is held for the user; relay their answer once given.",
          );
        }
        yield* nonEmpty(command.text, "The answer");
        emit({
          type: "decision.closed",
          decisionId: command.decisionId,
          kind: "answered",
          text: command.text,
        });
        break;
      }
      case "decision.mark-moot": {
        yield* ownOpenDecision(command.pivotThreadId, command.decisionId);
        yield* nonEmpty(command.evidence, "The evidence");
        emit({
          type: "decision.closed",
          decisionId: command.decisionId,
          kind: "moot",
          text: command.evidence,
        });
        break;
      }
    }
    return drafts;
  });

  // --- Applying ---

  const plus = (iso: string, ms: number) =>
    DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(iso), { milliseconds: ms }));

  const apply = Effect.fn("PivotStore.apply")(function* (stored: StoredPivotEvent) {
    const event = stored.event;
    const at = stored.occurredAt;
    switch (event.type) {
      case "pivot.created": {
        const predecessor =
          event.predecessorThreadId === null ? null : yield* readPivot(event.predecessorThreadId);
        // A takeover inherits the predecessor's pending wakes; a fresh Pivot starts caught up.
        const cursor = predecessor?.wakeCursor ?? stored.sequence;
        const from = predecessor?.wakeFrom ?? stored.sequence;
        yield* sql`
          INSERT INTO pivot_pivots (
            thread_id, project_id, home_path, created_at, wake_cursor, wake_from
          ) VALUES (
            ${event.threadId}, ${event.projectId}, ${event.homePath}, ${at}, ${cursor}, ${from}
          )
        `;
        return;
      }
      case "pivot.retired": {
        yield* sql`
          UPDATE pivot_pivots SET retired_at = ${at}, successor_thread_id = ${event.successorThreadId}
          WHERE thread_id = ${event.threadId}
        `;
        yield* sql`
          UPDATE pivot_teammates SET pivot_thread_id = ${event.successorThreadId}
          WHERE pivot_thread_id = ${event.threadId} AND torn_down_at IS NULL
        `;
        yield* sql`
          UPDATE pivot_decisions SET pivot_thread_id = ${event.successorThreadId}
          WHERE pivot_thread_id = ${event.threadId} AND closed_at IS NULL
        `;
        return;
      }
      case "pivot.woke":
        yield* sql`
          UPDATE pivot_pivots
          SET wake_cursor = ${event.throughSequence}, wake_from = ${event.fromSequence}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.dispatched":
        yield* sql`
          INSERT INTO pivot_teammates (
            thread_id, pivot_thread_id, project_id, kind, title, branch, base_branch,
            worktree_path, delivery_mode, intent_json, spec, dispatched_at
          ) VALUES (
            ${event.threadId}, ${event.pivotThreadId}, ${event.projectId}, ${event.kind},
            ${event.title}, ${event.branch}, ${event.baseBranch}, ${event.worktreePath},
            ${event.deliveryMode}, ${encodeIntent([event.intent])}, ${event.spec}, ${at}
          )
        `;
        return;
      case "teammate.promoted":
        yield* sql`
          UPDATE pivot_teammates SET kind = 'ship', spec = ${event.spec}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.intent-added": {
        const teammate = yield* readTeammate(event.threadId);
        const intent = encodeIntent([...(teammate?.intent ?? []), event.text]);
        yield* sql`
          UPDATE pivot_teammates SET intent_json = ${intent} WHERE thread_id = ${event.threadId}
        `;
        return;
      }
      case "teammate.reported":
        yield* sql`
          UPDATE pivot_teammates SET report_json = ${encodeReport(event.report)}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.scout-report-recorded":
        yield* sql`
          UPDATE pivot_teammates SET scout_report = ${event.report}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.resume-changed":
        yield* sql`
          UPDATE pivot_teammates SET resume = ${event.resume} WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.status-observed": {
        const recheckAt =
          event.status === "paused" ? (event.pausedUntil ?? plus(at, PAUSED_RECHECK_MS)) : null;
        yield* sql`
          UPDATE pivot_teammates
          SET observed_status = ${event.status}, observed_run_id = ${event.runId},
            recheck_at = ${recheckAt}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      }
      case "teammate.stopped":
        yield* sql`
          UPDATE pivot_teammates SET stopped_run_id = ${event.runId ?? ""}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.relaunched":
        return;
      case "teammate.stuck":
        yield* sql`
          UPDATE pivot_teammates SET stuck_run_id = ${event.runId} WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.pause-rechecked":
        yield* sql`
          UPDATE pivot_teammates SET recheck_at = ${event.nextRecheckAt}
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "teammate.user-message":
      case "teammate.delivery-changed":
        return;
      case "teammate.torn-down":
        yield* sql`
          UPDATE pivot_teammates SET torn_down_at = ${at}, recheck_at = NULL
          WHERE thread_id = ${event.threadId}
        `;
        return;
      case "decision.opened":
        yield* sql`
          INSERT INTO pivot_decisions (
            decision_id, pivot_thread_id, teammate_thread_id, key, opened_by, summary, opened_at
          ) VALUES (
            ${event.decisionId}, ${event.pivotThreadId}, ${event.teammateThreadId}, ${event.key},
            ${event.openedBy}, ${event.summary}, ${at}
          )
        `;
        return;
      case "decision.escalated":
        yield* sql`
          UPDATE pivot_decisions
          SET escalation_json = ${encodeEscalation(event.escalation)}, escalated_at = ${at}
          WHERE decision_id = ${event.decisionId}
        `;
        return;
      case "decision.user-answered":
        yield* sql`
          UPDATE pivot_decisions SET user_answer = ${event.answer}, user_answered_at = ${at}
          WHERE decision_id = ${event.decisionId}
        `;
        return;
      case "decision.closed":
        yield* sql`
          UPDATE pivot_decisions
          SET resolution_json = ${encodeResolution({ kind: event.kind, text: event.text, closedAt: at })},
            closed_at = ${at}
          WHERE decision_id = ${event.decisionId}
        `;
        return;
    }
  });

  // --- Committing ---

  const ownerColumns = (event: PivotEvent) => {
    switch (event.type) {
      case "pivot.created":
      case "pivot.retired":
      case "pivot.woke":
        return { pivot: event.threadId, teammate: null, decision: null };
      case "teammate.dispatched":
        return { pivot: event.pivotThreadId, teammate: event.threadId, decision: null };
      case "decision.opened":
        return {
          pivot: event.pivotThreadId,
          teammate: event.teammateThreadId,
          decision: event.decisionId,
        };
      case "decision.escalated":
      case "decision.user-answered":
      case "decision.closed":
        return { pivot: null, teammate: null, decision: event.decisionId };
      default:
        return { pivot: null, teammate: event.threadId, decision: null };
    }
  };

  const insertEvent = (draft: Draft, now: string) => {
    const owner = ownerColumns(draft.event);
    return sql<{ readonly sequence: number }>`
      INSERT INTO pivot_events (
        type, pivot_thread_id, teammate_thread_id, decision_id, wakes, payload_json, occurred_at
      ) VALUES (
        ${draft.event.type}, ${owner.pivot}, ${owner.teammate}, ${owner.decision},
        ${draft.wakes ? 1 : 0}, ${encodeEvent(draft.event)}, ${now}
      )
      RETURNING sequence
    `.pipe(
      Effect.map((rows): StoredPivotEvent => ({
        sequence: rows[0]!.sequence,
        occurredAt: now,
        wakes: draft.wakes,
        event: draft.event,
      })),
    );
  };

  /** The records the events touched, read after they applied, for the stream. */
  const changedRecords = Effect.fn("PivotStore.changedRecords")(function* (
    events: ReadonlyArray<StoredPivotEvent>,
  ) {
    const pivotIds = new Set<string>();
    const teammateIds = new Set<string>();
    const decisionIds = new Set<string>();
    for (const { event } of events) {
      const owner = ownerColumns(event);
      if (owner.pivot !== null) pivotIds.add(owner.pivot);
      if (owner.teammate !== null) teammateIds.add(owner.teammate);
      if (owner.decision !== null) decisionIds.add(owner.decision);
      if (event.type === "pivot.retired") pivotIds.add(event.successorThreadId);
    }
    const decisions: Array<PivotDecision> = [];
    for (const id of decisionIds) {
      const decision = yield* readDecision(id);
      if (decision === null) continue;
      pivotIds.add(decision.pivotThreadId);
      if (decision.teammateThreadId !== null) teammateIds.add(decision.teammateThreadId);
      if (decision.escalatedAt !== null) decisions.push(decision);
    }
    const pivots: Array<PivotRecord> = [];
    for (const id of pivotIds) {
      const pivot = yield* readPivot(id);
      if (pivot !== null) pivots.push(pivotRecord(pivot));
    }
    // A takeover moves teammates and decisions wholesale.
    const retirements = events.flatMap(({ event }) =>
      event.type === "pivot.retired" ? [event.successorThreadId] : [],
    );
    for (const successor of retirements) {
      const moved = yield* sql<TeammateSqlRow>`
        ${teammateSelect} WHERE t.pivot_thread_id = ${successor}
      `;
      for (const row of moved) teammateIds.add(row.thread_id);
      const movedDecisions = yield* sql<DecisionSqlRow>`
        SELECT * FROM pivot_decisions
        WHERE pivot_thread_id = ${successor} AND escalated_at IS NOT NULL AND closed_at IS NULL
      `;
      for (const row of movedDecisions) {
        if (!decisionIds.has(row.decision_id)) decisions.push(toDecision(row));
      }
    }
    const teammates: Array<TeammateRecord> = [];
    for (const id of teammateIds) {
      const teammate = yield* readTeammate(id);
      if (teammate !== null) teammates.push(teammateRecord(teammate));
    }
    return { _tag: "changed" as const, pivots, teammates, decisions };
  });

  const dispatch: PivotStore["Service"]["dispatch"] = (command) =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        const { stored, changed } = yield* Effect.gen(function* () {
          const drafts = yield* decide(command, now);
          const stored: Array<StoredPivotEvent> = [];
          for (const draft of drafts) {
            const event = yield* insertEvent(draft, now);
            yield* apply(event);
            stored.push(event);
          }
          const changed = stored.length === 0 ? null : yield* changedRecords(stored);
          return { stored, changed };
        }).pipe(
          sql.withTransaction,
          Effect.catchTag("SqlError", (cause) => Effect.fail(storeError(command.type)(cause))),
        );
        if (changed !== null) yield* PubSub.publish(changes, changed);
        return stored;
      }),
    );

  const read = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError(storeError(operation)));

  const snapshot = read(
    "snapshot",
    Effect.gen(function* () {
      const pivots = yield* sql<PivotSqlRow>`${pivotSelect} ORDER BY p.created_at`;
      const teammates =
        yield* sql<TeammateSqlRow>`${teammateSelect} ORDER BY t.dispatched_at, t.rowid`;
      const decisions = yield* sql<DecisionSqlRow>`
        SELECT * FROM pivot_decisions
        WHERE escalated_at IS NOT NULL AND closed_at IS NULL ORDER BY opened_at
      `;
      return {
        _tag: "snapshot" as const,
        pivots: pivots.map((row) => pivotRecord(toPivot(row))),
        teammates: teammates.map((row) => teammateRecord(toTeammate(row))),
        decisions: decisions.map(toDecision),
      };
    }),
  );

  const stream: PivotStore["Service"]["stream"] = Stream.unwrap(
    // Subscribe and snapshot under the write lock, so no commit lands between them.
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        const first = yield* snapshot;
        return Stream.concat(Stream.make(first), Stream.fromSubscription(subscription));
      }),
    ),
  );

  return PivotStore.of({
    dispatch,
    getPivot: (threadId) => read("getPivot", readPivot(threadId)),
    getActivePivot: (projectId) => read("getActivePivot", readActivePivot(projectId)),
    listActivePivots: read(
      "listActivePivots",
      sql<PivotSqlRow>`${pivotSelect} WHERE p.retired_at IS NULL`.pipe(
        Effect.map((rows) => rows.map(toPivot)),
      ),
    ),
    getTeammate: (threadId) => read("getTeammate", readTeammate(threadId)),
    listTeammates: ({ pivotThreadId, includeTornDown }) =>
      read(
        "listTeammates",
        sql<TeammateSqlRow>`
          ${teammateSelect}
          WHERE ${pivotThreadId === undefined ? sql`1 = 1` : sql`t.pivot_thread_id = ${pivotThreadId}`}
            AND ${includeTornDown ? sql`1 = 1` : sql`t.torn_down_at IS NULL`}
          ORDER BY t.dispatched_at, t.rowid
        `.pipe(Effect.map((rows) => rows.map(toTeammate))),
      ),
    getDecision: (decisionId) => read("getDecision", readDecision(decisionId)),
    listDecisions: ({ pivotThreadId, openOnly }) =>
      read(
        "listDecisions",
        sql<DecisionSqlRow>`
          SELECT * FROM pivot_decisions
          WHERE pivot_thread_id = ${pivotThreadId}
            AND ${openOnly ? sql`closed_at IS NULL` : sql`1 = 1`}
          ORDER BY opened_at, rowid
        `.pipe(Effect.map((rows) => rows.map(toDecision))),
      ),
    teammateHistory: ({ threadId, beforeSequence, limit }) =>
      read(
        "teammateHistory",
        sql<EventSqlRow>`
          SELECT e.sequence, e.occurred_at, e.wakes, e.payload_json FROM pivot_events e
          WHERE (e.teammate_thread_id = ${threadId}
              OR e.decision_id IN (
                SELECT decision_id FROM pivot_decisions WHERE teammate_thread_id = ${threadId}))
            AND e.sequence < ${beforeSequence ?? Number.MAX_SAFE_INTEGER}
          ORDER BY e.sequence DESC
          LIMIT ${limit}
        `.pipe(Effect.map((rows) => rows.map(toStoredEvent))),
      ),
    pendingWake: (pivotThreadId, afterSequence) =>
      read(
        "pendingWake",
        sql<EventSqlRow>`
          SELECT e.sequence, e.occurred_at, e.wakes, e.payload_json
          FROM pivot_events e
          JOIN pivot_pivots p ON p.thread_id = ${pivotThreadId}
          LEFT JOIN pivot_teammates t ON t.thread_id = e.teammate_thread_id
          LEFT JOIN pivot_decisions d ON d.decision_id = e.decision_id
          WHERE e.wakes = 1 AND e.sequence > ${afterSequence ?? sql`p.wake_cursor`}
            AND COALESCE(d.pivot_thread_id, t.pivot_thread_id) = ${pivotThreadId}
          ORDER BY e.sequence
        `.pipe(Effect.map((rows) => rows.map(toStoredEvent))),
      ),
    stream,
  });
});

export const layer = Layer.effect(PivotStore, make);
