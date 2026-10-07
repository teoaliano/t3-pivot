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

import { randomUuidV4 } from "../orchestration-v2/RandomUuid.ts";
import * as ServerActivation from "../serverActivation.ts";
import { loadPivotText } from "./pivotTexts.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotThreads from "./PivotThreads.ts";
import type { SeenPullRequest } from "./PivotEvents.ts";
import { composeWake, type WakeDigest, type WakeTeammate } from "./pivotWake.ts";

/** A teammate still resuming this long after the supervisor started did not survive the restart. */
export const RESUME_GRACE_MS = 5 * 60 * 1000;
/** A running teammate with no activity this long wakes its Pivot, once per run. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;
/** How often the timers are checked when nothing else happens. */
const SWEEP_INTERVAL = "30 seconds";
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
  };

  // In memory, rebuilt from the records: nothing here outlives a restart that matters.
  const liveTeammates = new Map<string, ThreadId>();
  const dirty = new Set<string>();
  const lastActivity = new Map<string, number>();
  const seenUserMessages = new Set<string>();
  // A new report can change a teammate's status with no V2 event, so reports mark it too.
  const seenReports = new Map<string, string | null>();
  const knownPivots = new Set<string>();
  // The first wake after a server start, and a takeover's first, tell the whole state.
  const digests = new Map<string, WakeDigest>();
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
    for (const id of [...liveTeammates.keys()]) if (!current.has(id)) liveTeammates.delete(id);
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

  const handleEvent: PivotSupervisor["Service"]["handleEvent"] = (event) =>
    Effect.gen(function* () {
      if (!liveTeammates.has(event.threadId)) return;
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
      } satisfies WakeTeammate;
    });

  const wakePivot = (pivot: PivotStore.PivotRow) =>
    Effect.gen(function* () {
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
      const wake = composeWake({ events, teammates, openDecisions, digest, guidance });
      const messageId = MessageId.make(`pivot-wake-${yield* randomUuidV4}`);
      yield* threads.wake({
        pivotThreadId: pivot.threadId,
        messageId,
        text: wake.text,
        summary: wake.summary,
        teammateThreadIds: wake.teammateThreadIds,
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
          if (predecessor !== null) {
            digests.set(pivot.threadId, { kind: "takeover", predecessorThreadId: predecessor });
          }
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
    for (const pivot of yield* store.listActivePivots) yield* wakePivot(pivot);
  }).pipe(Effect.catchCause(logFailure("tick")));

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
          store.stream.pipe(
            Stream.runForEach(() => poke),
            Effect.catchCause(logFailure("stream")),
          ),
        );
        return yield* Effect.forever(
          Effect.gen(function* () {
            yield* tick;
            yield* Effect.raceFirst(Queue.take(signal), Effect.sleep(SWEEP_INTERVAL));
            // Streaming turns emit many events; at most one tick a second.
            yield* Effect.sleep(MIN_TICK_SPACING);
          }),
        );
      }),
    );
  });

  return PivotSupervisor.of({ start, handleEvent, tick });
});

export const layer = Layer.effect(PivotSupervisor, make);
