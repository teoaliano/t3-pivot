/**
 * The admission queue: agents waiting for the agents slice to have memory again.
 *
 * Every server on this machine shares one queue, kept in a file in the user's
 * runtime directory next to the slice it protects. A Pivot on another project
 * is another server, so a file is what lets them see one line. Changes take a
 * lock directory, which `mkdir` creates atomically, so two servers never admit
 * the head ticket twice.
 *
 * @module agentAdmission
 */
import type { MemoryProbe } from "@t3tools/shared/AgentScope";
import { AgentMemoryWaitError } from "@t3tools/shared/AgentScope";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export const ADMISSION_FILE = "t3code-agent-admission.json";

export interface Ticket {
  readonly id: string;
  readonly threadId: string | undefined;
  readonly queuedAt: number;
  /** Whether this agent had to wait. Only waiting agents honor the start spacing. */
  readonly waited: boolean;
}

export interface AdmissionQueue {
  readonly tickets: ReadonlyArray<Ticket>;
  readonly lastAdmittedAt: number | undefined;
}

export interface AdmissionTiming {
  /** Least time between two admissions that had to wait, so memory shows up first. */
  readonly spacingMs: number;
  /** A ticket older than this belongs to a server that is gone, so it is dropped. */
  readonly staleMs: number;
}

const QueueFile = Schema.Struct({
  tickets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      threadId: Schema.optionalKey(Schema.String),
      queuedAt: Schema.Number,
      waited: Schema.Boolean,
    }),
  ),
  lastAdmittedAt: Schema.optionalKey(Schema.Number),
});
const decodeQueue = Schema.decodeUnknownOption(Schema.fromJsonString(QueueFile));

export const emptyQueue: AdmissionQueue = { tickets: [], lastAdmittedAt: undefined };

/** Reads the queue file, treating a missing or damaged file as an empty queue. */
export function parseQueue(text: string): AdmissionQueue {
  const decoded = decodeQueue(text);
  if (Option.isNone(decoded)) return emptyQueue;
  return {
    tickets: decoded.value.tickets.map((ticket) => ({
      id: ticket.id,
      threadId: ticket.threadId,
      queuedAt: ticket.queuedAt,
      waited: ticket.waited,
    })),
    lastAdmittedAt: decoded.value.lastAdmittedAt,
  };
}

export const serializeQueue = (queue: AdmissionQueue) => JSON.stringify(queue);

/** The tickets that have not outlived `staleMs`. */
const live = (queue: AdmissionQueue, now: number, staleMs: number) =>
  queue.tickets.filter((ticket) => now - ticket.queuedAt < staleMs);

/**
 * Lets the ticket `id` start when it is first in line, memory is free, and the
 * spacing since the last admission has passed for a ticket that waited. Tickets
 * that never waited start at once, so a single dispatch is not delayed.
 */
export function tryAdmit(
  queue: AdmissionQueue,
  input: {
    readonly id: string;
    readonly threadId: string | undefined;
    readonly now: number;
    readonly memoryFree: boolean;
    readonly timing: AdmissionTiming;
  },
): { readonly queue: AdmissionQueue; readonly admitted: boolean } {
  let tickets = live(queue, input.now, input.timing.staleMs);
  if (!tickets.some((ticket) => ticket.id === input.id)) {
    tickets = [
      ...tickets,
      {
        id: input.id,
        threadId: input.threadId,
        queuedAt: input.now,
        // A ticket waits when memory is short or others already queued.
        waited: tickets.length > 0 || !input.memoryFree,
      },
    ];
  }
  const head = tickets[0];
  const spaced =
    head?.waited !== true ||
    queue.lastAdmittedAt === undefined ||
    input.now - queue.lastAdmittedAt >= input.timing.spacingMs;
  if (head?.id !== input.id || !input.memoryFree || !spaced) {
    return { queue: { tickets, lastAdmittedAt: queue.lastAdmittedAt }, admitted: false };
  }
  return { queue: { tickets: tickets.slice(1), lastAdmittedAt: input.now }, admitted: true };
}

export const removeTicket = (queue: AdmissionQueue, id: string): AdmissionQueue => ({
  tickets: queue.tickets.filter((ticket) => ticket.id !== id),
  lastAdmittedAt: queue.lastAdmittedAt,
});

const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 10_000;

const isAlreadyExists = (error: PlatformError.PlatformError) =>
  error.reason._tag === "AlreadyExists";

/** Runs `effect` while holding the directory lock beside the queue file. */
const withLock = <A, E, R>(
  fs: FileSystem.FileSystem,
  lockPath: string,
  effect: Effect.Effect<A, E, R>,
) => {
  const acquire = Effect.gen(function* () {
    while (true) {
      const held = yield* fs.makeDirectory(lockPath, { recursive: false }).pipe(
        Effect.as(true),
        Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
      );
      if (held) return;
      // A server that died holding the lock leaves it behind; break it once it is old.
      const info = yield* fs.stat(lockPath).pipe(Effect.option);
      if (Option.isSome(info) && Option.isSome(info.value.mtime)) {
        const now = yield* Clock.currentTimeMillis;
        if (now - info.value.mtime.value.getTime() > LOCK_STALE_MS) {
          yield* fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore);
        }
      }
      yield* Effect.sleep(LOCK_RETRY_MS);
    }
  });
  return Effect.acquireUseRelease(
    acquire,
    () => effect,
    () => fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore),
  );
};

const readQueue = (fs: FileSystem.FileSystem, queuePath: string) =>
  fs.readFileString(queuePath).pipe(
    Effect.map(parseQueue),
    Effect.orElseSucceed(() => emptyQueue),
  );

/** Reads the queue under the lock, updates it, and writes it back. */
const modifyQueue = <A>(
  fs: FileSystem.FileSystem,
  queuePath: string,
  update: (queue: AdmissionQueue) => { readonly queue: AdmissionQueue; readonly result: A },
) =>
  withLock(
    fs,
    `${queuePath}.lock`,
    Effect.gen(function* () {
      const next = update(yield* readQueue(fs, queuePath));
      yield* fs.writeFileString(queuePath, serializeQueue(next.queue));
      return next.result;
    }),
  );

/** The threads that wait in the queue now. Read without the lock; a stale read only lags. */
export const queuedThreads = (
  fs: FileSystem.FileSystem,
  queuePath: string,
  now: number,
  timing: AdmissionTiming,
) =>
  readQueue(fs, queuePath).pipe(
    Effect.map(
      (queue) =>
        new Set(
          live(queue, now, timing.staleMs).flatMap((ticket) =>
            ticket.threadId === undefined ? [] : [ticket.threadId],
          ),
        ),
    ),
  );

const gigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/** `agents use 9.7 of 9.4 GB`, or `agents use 9.7 GB` when the slice has no high mark. */
export const memoryStatus = (probe: MemoryProbe) =>
  probe.highBytes === undefined
    ? `agents use ${gigabytes(probe.currentBytes)} GB`
    : `agents use ${gigabytes(probe.currentBytes)} of ${gigabytes(probe.highBytes)} GB`;

export const memoryWaitStatus = (probe: MemoryProbe | undefined) =>
  probe === undefined ? "Waiting for memory" : `Waiting for memory: ${memoryStatus(probe)}`;

/**
 * Waits in line until the machine has memory for one more agent. A missing probe
 * counts as free memory, so an unmeasured machine never blocks a start.
 */
export const admitAgent = (input: {
  readonly fs: FileSystem.FileSystem;
  readonly queuePath: string;
  readonly ticketId: string;
  readonly threadId: string | undefined;
  readonly probe: Effect.Effect<MemoryProbe | undefined>;
  readonly timing: AdmissionTiming;
  readonly timeoutMs: number;
  readonly pollMs: number;
}): Effect.Effect<void, AgentMemoryWaitError> =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    let logged = false;
    while (true) {
      const probe = yield* input.probe;
      const now = yield* Clock.currentTimeMillis;
      const memoryFree = probe === undefined || probe.state === "ok";
      const admitted = yield* modifyQueue(input.fs, input.queuePath, (queue) => {
        const next = tryAdmit(queue, {
          id: input.ticketId,
          threadId: input.threadId,
          now,
          memoryFree,
          timing: input.timing,
        });
        return { queue: next.queue, result: next.admitted };
      }).pipe(
        // The gate fails open: a queue file we cannot write must not stop every agent.
        Effect.catch((error) =>
          Effect.logWarning("Agent admission queue unavailable; starting without it", {
            error: error.message,
          }).pipe(Effect.as(true)),
        ),
      );
      if (admitted) return;
      if (!logged) {
        logged = true;
        yield* Effect.logInfo("Agent waits for memory before it starts", {
          threadId: input.threadId,
          status: memoryWaitStatus(probe),
        });
      }
      if (now - started >= input.timeoutMs) {
        yield* modifyQueue(input.fs, input.queuePath, (queue) => ({
          queue: removeTicket(queue, input.ticketId),
          result: undefined,
        })).pipe(Effect.ignore);
        return yield* new AgentMemoryWaitError({
          summary:
            probe === undefined
              ? "Not started: the machine did not have memory for another agent in time. Retry once a running agent finishes."
              : `Not started: the machine does not have memory for another agent (${memoryStatus(probe)}). Retry once a running agent finishes.`,
        });
      }
      yield* Effect.sleep(input.pollMs);
    }
  });
