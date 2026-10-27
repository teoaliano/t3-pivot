/**
 * PivotSupervisor - everything in Pivot mode that happens without a caller.
 *
 * It listens to V2's events, records each teammate change it sees (a status
 * transition, a direct message from the user, and from the thread's PR links, a PR
 * merged or closed or checks gone red) as an event in Pivot mode's own log, runs the `paused` recheck and the
 * 30-minute stuck bound, and wakes each Pivot with a notification message listing
 * what changed since its last wake. Wakes are derived from the log after each
 * Pivot's wake cursor, so a restart loses none; the timers read their deadlines,
 * and PR changes their last sighting, from the records.
 *
 * @module PivotSupervisor
 */
import {
  MessageId,
  type RunId,
  type TeammateStatus,
  type ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { deriveTeammateStatus } from "@t3tools/shared/teammateStatus";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { AgentScope } from "@t3tools/shared/AgentScope";
import { memoryWaitStatus } from "../process/agentAdmission.ts";
import * as ServerActivation from "../serverActivation.ts";
import { renderHandoffRequest } from "./pivotBrief.ts";
import { loadPivotText } from "./pivotTexts.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotThreads from "./PivotThreads.ts";
import type { SeenPullRequest } from "./PivotEvents.ts";
import { composeWake, type WakeDigest, type WakeTeammate } from "./pivotWake.ts";

/** A teammate still resuming this long after the supervisor started did not survive the restart. */
export const RESUME_GRACE_MS = 5 * 60 * 1000;
/** How long a takeover waits for the retired Pivot's handoff before going on without it. */
export const HANDOFF_WAIT_MS = 2 * 60 * 1000;
/** A running teammate with no activity this long wakes its Pivot, once per run. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;
/** A hosted teammate's activity is logged at most this often, since a turn emits many events. */
export const HOSTED_ACTIVITY_LOG_SPACING_MS = 30 * 1000;
/** How often the timers are checked when nothing else happens. */
const SWEEP_INTERVAL = "30 seconds";
// How often teammates waiting for memory are looked for; a start asks every 5 seconds.
const MEMORY_WAIT_INTERVAL = "5 seconds";
const MIN_TICK_SPACING = "1 second";

export class PivotSupervisor extends Context.Service<
  PivotSupervisor,
  {
    /** Runs the supervisor until the scope closes, after server activation. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** Reacts to one V2 event: marks the teammate for observation and records what it carries. */
    readonly handleEvent: (event: PivotThreads.PivotThreadEvent) => Effect.Effect<void>;
    /**
     * Observes every teammate that may have changed, runs due rechecks and the stuck
     * bound, and wakes every Pivot with something pending.
     */
    readonly tick: Effect.Effect<void>;
    /** Records which of this server's teammates wait for memory, and why. */
    readonly observeMemoryWaits: Effect.Effect<void>;
  }
>()("t3/pivot/PivotSupervisor") {}

const RESUMED: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const FAILING_CHECKS = new Set(["failing", "failure", "failed", "error"]);

const seenPullRequests = (links: ReadonlyArray<ThreadPullRequestLink>): Array<SeenPullRequest> =>
  links.flatMap((link) =>
    link.source === "stack-dismissed" || link.snapshot === null
      ? []
      : [
          {
            url: link.url,
            state: link.snapshot.state,
            checksFailing: FAILING_CHECKS.has(String(link.snapshot.checksState ?? "")),
          },
        ],
  );

const toMillis = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (DateTime.isDateTime(value)) return DateTime.toEpochMillis(value);
  return null;
};

export const make = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  const hostStore = yield* PivotHostStore.PivotHostStore;
  const threads = yield* PivotThreads.PivotThreads;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const text = (name: string) =>
    loadPivotText(name).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.orElseSucceed(() => ""),
    );
  const guidance = {
    stuck: yield* text("stuck-teammate-ladder"),
    failed: yield* text("failed-teammate-diagnosis"),
    handoff: yield* text("handoff-request"),
  };

  // In memory, rebuilt from the records: nothing here outlives a restart that matters.
  const liveTeammates = new Map<string, ThreadId>();
  const dirty = new Set<string>();
  const lastActivity = new Map<string, number>();
  const hostedActivityLoggedAt = new Map<string, number>();
  const seenUserMessages = new Set<string>();
  // A new report can change a teammate's status with no V2 event, so reports mark it too.
  const seenReports = new Map<string, string | null>();
  const knownPivots = new Set<string>();
  // The first wake after a server start, and a takeover's first, tell the whole state.
  const digests = new Map<string, WakeDigest>();
  // Takeovers whose successor waits for the retired Pivot's handoff, by successor. A restart
  // forgets them: the successor then opens with the restart digest.
  const handoffs = new Map<
    string,
    { readonly predecessor: ThreadId; readonly runId: RunId; readonly askedAtMs: number }
  >();
  let started = false;
  let startedAtMs: number | null = null;

  const logFailure = (operation: string) => (cause: unknown) =>
    Effect.logWarning("Pivot supervisor step failed", { operation, cause });

  const record = (command: PivotStore.PivotCommand) =>
    store.dispatch(command).pipe(Effect.asVoid, Effect.catchCause(logFailure(command.type)));

  const refreshTeammates = Effect.gen(function* () {
    const teammates = yield* store.listTeammates({ includeTornDown: false });
    const now = yield* Clock.currentTimeMillis;
    const current = new Set(teammates.map((teammate) => teammate.threadId as string));
    for (const id of liveTeammates.keys()) if (!current.has(id)) liveTeammates.delete(id);
    for (const teammate of teammates) {
      const reportedAt = teammate.report?.reportedAt ?? null;
      if (seenReports.get(teammate.threadId) !== reportedAt) {
        seenReports.set(teammate.threadId, reportedAt);
        dirty.add(teammate.threadId);
      }
      if (!liveTeammates.has(teammate.threadId)) {
        liveTeammates.set(teammate.threadId, teammate.threadId);
        dirty.add(teammate.threadId);
        if (!lastActivity.has(teammate.threadId)) lastActivity.set(teammate.threadId, now);
      }
    }
    return teammates;
  });

  /**
   * What a teammate this environment hosts for another environment's Pivot does goes
   * to the hosted log, narrowed as for a local one. This environment holds no Pivot to
   * wake, and the home reads the log when it can.
   */
  const handleHostedEvent = (event: PivotThreads.PivotThreadEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "activity": {
          const now = yield* Clock.currentTimeMillis;
          const loggedAt = hostedActivityLoggedAt.get(event.threadId);
          if (loggedAt !== undefined && now - loggedAt < HOSTED_ACTIVITY_LOG_SPACING_MS) return;
          hostedActivityLoggedAt.set(event.threadId, now);
          yield* hostStore.appendEvent({ threadId: event.threadId, event: { _tag: "activity" } });
          return;
        }
        case "user-message": {
          if (seenUserMessages.has(event.messageId)) return;
          if (seenUserMessages.size > 10_000) seenUserMessages.clear();
          seenUserMessages.add(event.messageId);
          yield* hostStore.appendEvent({
            threadId: event.threadId,
            event: { _tag: "user-message", text: event.text },
          });
          return;
        }
        case "request-answered":
          yield* hostStore.appendEvent({
            threadId: event.threadId,
            event: { _tag: "request-answered", answer: event.answer },
          });
          return;
      }
    }).pipe(Effect.catchCause(logFailure("hosted event")));

  const handleEvent: PivotSupervisor["Service"]["handleEvent"] = (event) =>
    Effect.gen(function* () {
      if (!liveTeammates.has(event.threadId)) {
        if (yield* hostStore.isLive(event.threadId)) yield* handleHostedEvent(event);
        return;
      }
      dirty.add(event.threadId);
      lastActivity.set(event.threadId, yield* Clock.currentTimeMillis);
      switch (event.type) {
        case "activity":
          return;
        case "user-message": {
          if (seenUserMessages.has(event.messageId)) return;
          if (seenUserMessages.size > 10_000) seenUserMessages.clear();
          seenUserMessages.add(event.messageId);
          yield* record({
            type: "teammate.record-user-message",
            threadId: event.threadId,
            text: event.text,
          });
          return;
        }
        case "request-answered":
          yield* record({
            type: "teammate.record-request-answer",
            threadId: event.threadId,
            answer: event.answer,
          });
          return;
      }
    });

  const observe = (threadId: ThreadId) =>
    Effect.gen(function* () {
      let teammate = yield* store.getTeammate(threadId);
      if (teammate === null || teammate.tornDownAt !== null) return;
      const shell = yield* threads.shell(threadId);
      if (shell === null) return;
      if (teammate.resume === "pending") {
        // Resumed once its run is going again; did not survive if it failed or never came back.
        const now = yield* Clock.currentTimeMillis;
        const resume = RESUMED.has(shell.status)
          ? null
          : shell.status === "failed" || now - (startedAtMs ?? now) >= RESUME_GRACE_MS
            ? ("failed" as const)
            : ("pending" as const);
        if (resume !== "pending") {
          yield* record({ type: "teammate.set-resume", threadId, resume });
          teammate = { ...teammate, resume };
        }
      }
      const derived = deriveTeammateStatus({
        status: shell.status,
        latestRunId: shell.latestRunId,
        pendingRuntimeRequest: shell.pendingRuntimeRequest,
        pendingBackgroundTasks: shell.pendingBackgroundTasks ?? [],
        lastError: shell.lastError ?? null,
        usageLimitResetAt: shell.usageLimitResetAt ?? null,
        teammate,
      });
      const reportUntil =
        teammate.report?.status === "paused" && teammate.report.runId === shell.latestRunId
          ? (teammate.report.until ?? null)
          : null;
      yield* record({
        type: "teammate.observe-status",
        threadId,
        status: derived.status,
        runId: shell.latestRunId,
        detail: derived.detail,
        pausedUntil:
          derived.status === "paused" ? (reportUntil ?? shell.usageLimitResetAt ?? null) : null,
      });
      // After the status, so checks gone red read against a `done` seen in the same pass.
      // V2 commits a PR sync to the shell before its event goes out, so the shell is current.
      yield* record({
        type: "teammate.observe-pull-requests",
        threadId,
        pullRequests: seenPullRequests(shell.pullRequests ?? []),
      });
    }).pipe(Effect.catchCause(logFailure("observe")));

  const runTimers = (teammates: ReadonlyArray<PivotStore.TeammateRow>) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const teammate of teammates) {
        const recheckAt = toMillis(teammate.recheckAt);
        if (teammate.observedStatus === "paused" && recheckAt !== null && recheckAt <= now) {
          yield* record({ type: "teammate.recheck-paused", threadId: teammate.threadId });
        }
        if (teammate.observedStatus !== "working") continue;
        const quietSince = lastActivity.get(teammate.threadId) ?? now;
        if (now - quietSince < STUCK_AFTER_MS) continue;
        const shell = yield* threads
          .shell(teammate.threadId)
          .pipe(Effect.orElseSucceed(() => null));
        const runId = shell?.activeRunId ?? null;
        if (runId === null || teammate.stuckRunId === runId) continue;
        // Once per run, and never an interrupt: the Pivot decides.
        yield* record({ type: "teammate.mark-stuck", threadId: teammate.threadId, runId });
      }
    });

  const wakeTeammate = (row: PivotStore.TeammateRow) =>
    Effect.gen(function* () {
      const shell = yield* threads.shell(row.threadId).pipe(Effect.orElseSucceed(() => null));
      const derived: { status: TeammateStatus; detail: string | null } =
        shell === null
          ? { status: row.observedStatus ?? "unreported", detail: null }
          : deriveTeammateStatus({
              status: shell.status,
              latestRunId: shell.latestRunId,
              pendingRuntimeRequest: shell.pendingRuntimeRequest,
              pendingBackgroundTasks: shell.pendingBackgroundTasks ?? [],
              lastError: shell.lastError ?? null,
              usageLimitResetAt: shell.usageLimitResetAt ?? null,
              teammate: row,
            });
      return {
        threadId: row.threadId,
        title: row.title,
        kind: row.kind,
        status: derived.status,
        summary: derived.detail ?? row.report?.summary ?? null,
        resume: row.resume,
        tornDown: row.tornDownAt !== null,
        branch: row.branch,
        worktreePath: row.worktreePath,
        goal: row.intent[0] ?? null,
        verdict: row.verdict?.text ?? null,
      } satisfies WakeTeammate;
    });

  /**
   * The successor opens with the retired Pivot's handoff, or a note that it has none, and the
   * retired thread settles now that its work moved on.
   */
  const settleHandoff = (successor: ThreadId, predecessor: ThreadId, handoff: string | null) =>
    Effect.gen(function* () {
      handoffs.delete(successor);
      if (handoff !== null) {
        yield* record({ type: "pivot.record-handoff", threadId: predecessor, text: handoff });
      }
      digests.set(successor, { kind: "takeover", predecessorThreadId: predecessor, handoff });
      yield* threads.settle(predecessor).pipe(Effect.catchCause(logFailure("settle")));
    });

  const askForHandoff = (successor: ThreadId, predecessor: ThreadId) =>
    Effect.gen(function* () {
      const askedAtMs = yield* Clock.currentTimeMillis;
      const runId = yield* threads
        .request({
          threadId: predecessor,
          senderThreadId: successor,
          text: renderHandoffRequest(guidance.handoff, { successorThreadId: successor }),
        })
        .pipe(Effect.catchCause((cause) => Effect.as(logFailure("handoff")(cause), null)));
      if (runId === null) return yield* settleHandoff(successor, predecessor, null);
      handoffs.set(successor, { predecessor, runId, askedAtMs });
    });

  /** Takes each handoff whose reply came, and gives up on each whose wait is over. */
  const advanceHandoffs = Effect.gen(function* () {
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const [successor, pending] of [...handoffs]) {
      const reply = yield* threads
        .runReply(pending.predecessor, pending.runId)
        .pipe(Effect.orElseSucceed(() => ({ type: "pending" as const })));
      if (reply.type === "ended") {
        yield* settleHandoff(successor as ThreadId, pending.predecessor, reply.text);
      } else if ((yield* Clock.currentTimeMillis) - pending.askedAtMs >= HANDOFF_WAIT_MS) {
        yield* settleHandoff(successor as ThreadId, pending.predecessor, null);
      }
    }
  });

  const wakePivot = (pivot: PivotStore.PivotRow) =>
    Effect.gen(function* () {
      // A takeover's first wake carries the handoff, so it waits for it.
      if (handoffs.has(pivot.threadId)) return;
      const digest = digests.get(pivot.threadId) ?? null;
      const fresh = yield* store.pendingWake(pivot.threadId);
      const forced = digest?.kind === "takeover";
      if (fresh.length === 0 && !forced) return;
      // A wake still queued is rebuilt to carry everything since it began.
      const joining = yield* threads.hasQueuedWake(pivot.threadId);
      const from = joining ? pivot.wakeFrom : pivot.wakeCursor;
      const events = joining ? yield* store.pendingWake(pivot.threadId, from) : fresh;
      const rows = yield* store.listTeammates({
        pivotThreadId: pivot.threadId,
        includeTornDown: true,
      });
      const teammates = new Map<string, WakeTeammate>();
      for (const row of rows) teammates.set(row.threadId, yield* wakeTeammate(row));
      const openDecisions = yield* store.listDecisions({
        pivotThreadId: pivot.threadId,
        openOnly: true,
      });
      const wake = composeWake({
        events,
        teammates,
        openDecisions,
        digest,
        guidance: { stuck: guidance.stuck, failed: guidance.failed },
      });
      const messageId = MessageId.make(`pivot-wake-${yield* randomUuidV4}`);
      yield* threads.wake({
        pivotThreadId: pivot.threadId,
        messageId,
        text: wake.text,
        summary: wake.summary,
        teammateThreadIds: wake.teammateThreadIds,
        attachments: wake.attachments,
      });
      digests.delete(pivot.threadId);
      const through = events.at(-1)?.sequence ?? pivot.wakeCursor;
      if (through > pivot.wakeCursor) {
        yield* store.dispatch({
          type: "pivot.record-wake",
          threadId: pivot.threadId,
          messageId,
          fromSequence: from,
          throughSequence: through,
        });
      }
    }).pipe(Effect.catchCause(logFailure("wake")));

  /**
   * A Pivot that existed before this server started opens its next wake, whenever it
   * comes, with a restart digest; a takeover created later opens with its own.
   */
  const notePivots = (pivots: ReadonlyArray<PivotStore.PivotRow>) =>
    Effect.gen(function* () {
      for (const pivot of pivots) {
        if (knownPivots.has(pivot.threadId)) continue;
        if (!started) {
          const createdAt = toMillis(pivot.createdAt);
          if (createdAt !== null && startedAtMs !== null && createdAt < startedAtMs) {
            digests.set(pivot.threadId, { kind: "restart" });
          }
        } else {
          const predecessor = yield* findPredecessor(pivot.threadId);
          if (predecessor !== null) yield* askForHandoff(pivot.threadId, predecessor);
        }
        knownPivots.add(pivot.threadId);
      }
      started = true;
    });

  const findPredecessor = (threadId: ThreadId) =>
    Effect.gen(function* () {
      for (const id of knownPivots) {
        const pivot = yield* store.getPivot(id as ThreadId).pipe(Effect.orElseSucceed(() => null));
        if (pivot?.successorThreadId === threadId) return pivot.threadId;
      }
      return null;
    });

  const tick: PivotSupervisor["Service"]["tick"] = Effect.gen(function* () {
    const teammates = yield* refreshTeammates;
    const pivots = yield* store.listActivePivots;
    if (startedAtMs === null) {
      startedAtMs = yield* Clock.currentTimeMillis;
      // A Pivot and its teammates carry on after a restart: restart recovery held their
      // queues behind the resumed turn, and they go on without waiting for the user.
      for (const threadId of [
        ...pivots.map((pivot) => pivot.threadId),
        ...teammates.map((teammate) => teammate.threadId),
        ...(yield* hostStore.liveThreadIds),
      ]) {
        yield* threads
          .releaseHeldQueue(threadId)
          .pipe(Effect.catchCause(logFailure("release queue")));
      }
    }
    for (const teammate of teammates) {
      if (teammate.resume === "pending") dirty.add(teammate.threadId);
    }
    yield* notePivots(pivots);
    // A snapshot: `observe` yields, and other fibers mark threads dirty meanwhile.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const threadId of [...dirty]) {
      dirty.delete(threadId);
      yield* observe(threadId as ThreadId);
    }
    // Re-read: observing may have just moved a teammate into `paused` or `working`.
    yield* runTimers(
      yield* store
        .listTeammates({ includeTornDown: false })
        .pipe(Effect.orElseSucceed(() => teammates)),
    );
    yield* advanceHandoffs.pipe(Effect.catchCause(logFailure("handoffs")));
    for (const pivot of yield* store.listActivePivots) yield* wakePivot(pivot);
  }).pipe(Effect.catchCause(logFailure("tick")));

  // A teammate whose agent is held back for memory shows why on its card and in
  // list_teammates, and stops showing it once its agent starts. Only this server's own
  // teammates: a teammate on another environment waits in that machine's queue.
  const agentScope = yield* AgentScope;
  const observeMemoryWaits = Effect.gen(function* () {
    const queued = yield* agentScope.queuedThreadIds();
    const teammates = yield* store.listTeammates({ includeTornDown: false });
    const waiting = teammates.some((teammate) => queued.has(teammate.threadId));
    const status = waiting ? memoryWaitStatus(yield* agentScope.memory()) : null;
    for (const teammate of teammates) {
      if (teammate.environmentId !== null) continue;
      const next = queued.has(teammate.threadId) ? status : null;
      // Recorded when the wait starts and ends, not on every reading in between: each
      // change is an event the Pivot's history keeps.
      if ((teammate.memoryWait === null) === (next === null)) continue;
      yield* store.dispatch({
        type: "teammate.observe-memory-wait",
        threadId: teammate.threadId,
        status: next,
      });
    }
  }).pipe(Effect.catchCause(logFailure("memory waits")));

  const start: PivotSupervisor["Service"]["start"] = Effect.gen(function* () {
    const signal = yield* Queue.sliding<void>(1);
    const poke = Queue.offer(signal, undefined).pipe(Effect.asVoid);
    yield* ServerActivation.forkParked(
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          threads.events.pipe(
            Stream.runForEach((event) => Effect.andThen(handleEvent(event), poke)),
          ),
        );
        yield* Effect.forkScoped(
          Effect.forever(Effect.andThen(observeMemoryWaits, Effect.sleep(MEMORY_WAIT_INTERVAL))),
        );
        yield* Effect.forkScoped(
          store.stream.pipe(
            Stream.runForEach(() => poke),
            Effect.catchCause(logFailure("stream")),
          ),
        );
        return yield* Effect.forever(
          Effect.gen(function* () {
            yield* tick;
            yield* Queue.take(signal).pipe(
              Effect.timeoutOrElse({ duration: SWEEP_INTERVAL, orElse: () => Effect.void }),
            );
            // Streaming turns emit many events; at most one tick a second.
            yield* Effect.sleep(MIN_TICK_SPACING);
          }),
        );
      }),
    );
  });

  return PivotSupervisor.of({ start, handleEvent, tick, observeMemoryWaits });
});

export const layer = Layer.effect(PivotSupervisor, make);
