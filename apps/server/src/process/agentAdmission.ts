/**
 * One queue file shared by every server on this machine, so all agents see one line.
 * Writes take an atomic `mkdir` lock and replace the file by rename, so a crash never
 * leaves half a queue. Nothing waits: a ticket drops out a few polls after its caller stops.
 */
import type { MemoryProbe, MemoryState } from "@t3tools/shared/AgentScope";
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
  /** When its caller last asked; a ticket nobody asks for goes stale. */
  readonly seenAt: number;
}

export interface AdmissionQueue {
  readonly tickets: ReadonlyArray<Ticket>;
}

export interface AdmissionTiming {
  /** A ticket not asked for in this long belongs to a start that gave up, so it is dropped. */
  readonly staleMs: number;
  /** How long a start may wait before it fails. */
  readonly timeoutMs: number;
}

const QueueFile = Schema.Struct({
  tickets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      threadId: Schema.optionalKey(Schema.String),
      queuedAt: Schema.Number,
      seenAt: Schema.Number,
    }),
  ),
});
const decodeQueue = Schema.decodeUnknownOption(Schema.fromJsonString(QueueFile));

export const emptyQueue: AdmissionQueue = { tickets: [] };

/** Reads the queue file, treating a missing or damaged file as an empty queue. */
export function parseQueue(text: string): AdmissionQueue {
  const decoded = decodeQueue(text);
  if (Option.isNone(decoded)) return emptyQueue;
  return {
    tickets: decoded.value.tickets.map((ticket) => ({
      id: ticket.id,
      threadId: ticket.threadId,
      queuedAt: ticket.queuedAt,
      seenAt: ticket.seenAt,
    })),
  };
}

export const serializeQueue = (queue: AdmissionQueue) => JSON.stringify(queue);

/** The tickets whose callers still ask. */
const live = (queue: AdmissionQueue, now: number, staleMs: number) =>
  queue.tickets.filter((ticket) => now - ticket.seenAt < staleMs);

export type AttemptOutcome =
  | { readonly _tag: "admitted" }
  | { readonly _tag: "waiting"; readonly position: number }
  | { readonly _tag: "expired" };

/**
 * One attempt for ticket `id`. An agent starts unless memory is starved, so a ticket
 * ahead of it never holds it back once memory is fine.
 */
export function tryAdmit(
  queue: AdmissionQueue,
  input: {
    readonly id: string;
    readonly threadId: string | undefined;
    readonly now: number;
    /** undefined where memory is not measured, which never holds a start back. */
    readonly memory: MemoryState | undefined;
    readonly timing: AdmissionTiming;
  },
): { readonly queue: AdmissionQueue; readonly outcome: AttemptOutcome } {
  const { now, timing } = input;
  const prior = queue.tickets.find((ticket) => ticket.id === input.id);
  // A ticket whose caller stopped asking lost its place; asking again joins at the back.
  const ticket: Ticket =
    prior !== undefined && now - prior.seenAt < timing.staleMs
      ? { ...prior, seenAt: now }
      : { id: input.id, threadId: input.threadId, queuedAt: now, seenAt: now };
  const inLine = [
    ...live(queue, now, timing.staleMs).filter((candidate) => candidate.id !== input.id),
    ticket,
  ].sort((a, b) => a.queuedAt - b.queuedAt);
  const others = { tickets: inLine.filter((candidate) => candidate.id !== input.id) };

  if (now - ticket.queuedAt >= timing.timeoutMs) {
    return { queue: others, outcome: { _tag: "expired" } };
  }
  if (input.memory !== "starved") {
    return { queue: others, outcome: { _tag: "admitted" } };
  }
  return {
    queue: { tickets: inLine },
    outcome: {
      _tag: "waiting",
      position: inLine.findIndex((candidate) => candidate.id === input.id) + 1,
    },
  };
}

const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 10_000;

const isAlreadyExists = (error: PlatformError.PlatformError) =>
  error.reason._tag === "AlreadyExists";

/**
 * Runs `effect` while holding the directory lock beside the queue file. The lock holds
 * its owner's token, so a release never removes a lock someone else took after breaking
 * a stale one.
 */
const withLock = <A, E, R>(
  fs: FileSystem.FileSystem,
  lockPath: string,
  token: string,
  effect: Effect.Effect<A, E, R>,
) => {
  const ownerFile = `${lockPath}/owner`;
  const acquire = Effect.gen(function* () {
    while (true) {
      const held = yield* fs.makeDirectory(lockPath, { recursive: false }).pipe(
        Effect.as(true),
        Effect.catchIf(isAlreadyExists, () => Effect.succeed(false)),
      );
      if (held) {
        yield* fs.writeFileString(ownerFile, token).pipe(Effect.ignore);
        return;
      }
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
  const release = Effect.gen(function* () {
    const owner = yield* fs.readFileString(ownerFile).pipe(Effect.option);
    if (Option.isSome(owner) && owner.value !== token) return;
    yield* fs.remove(lockPath, { recursive: true }).pipe(Effect.ignore);
  });
  return Effect.acquireUseRelease(
    acquire,
    () => effect,
    () => release,
  );
};

const readQueue = (fs: FileSystem.FileSystem, queuePath: string) =>
  fs.readFileString(queuePath).pipe(
    Effect.map(parseQueue),
    Effect.orElseSucceed(() => emptyQueue),
  );

/** Reads the queue under the lock, updates it, and replaces the file by rename. */
const modifyQueue = <A>(
  fs: FileSystem.FileSystem,
  queuePath: string,
  token: string,
  update: (queue: AdmissionQueue) => { readonly queue: AdmissionQueue; readonly result: A },
) =>
  withLock(
    fs,
    `${queuePath}.lock`,
    token,
    Effect.gen(function* () {
      const next = update(yield* readQueue(fs, queuePath));
      const temporary = `${queuePath}.${token}.tmp`;
      yield* fs.writeFileString(temporary, serializeQueue(next.queue));
      yield* fs.rename(temporary, queuePath);
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

export const memoryWaitStatus = (probe: MemoryProbe | undefined, position?: number) => {
  const place = position === undefined || position <= 1 ? "" : `, ${position} in line`;
  return probe === undefined
    ? `Waiting for memory${place}`
    : `Waiting for memory: ${memoryStatus(probe)}${place}`;
};

/**
 * Asks once whether an agent may start now. A machine whose memory is not measured, or
 * a queue file that cannot be written, never holds a start back.
 */
export const admitAgent = Effect.fn("agentAdmission.admitAgent")(function* (input: {
  readonly fs: FileSystem.FileSystem;
  readonly queuePath: string;
  readonly token: string;
  readonly ticketId: string;
  readonly threadId: string | undefined;
  readonly probe: Effect.Effect<MemoryProbe | undefined>;
  readonly timing: AdmissionTiming;
}) {
  const probe = yield* input.probe;
  const now = yield* Clock.currentTimeMillis;
  const outcome = yield* modifyQueue(input.fs, input.queuePath, input.token, (queue) => {
    const next = tryAdmit(queue, {
      id: input.ticketId,
      threadId: input.threadId,
      now,
      memory: probe?.state,
      timing: input.timing,
    });
    return { queue: next.queue, result: next.outcome };
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Agent admission queue unavailable; starting without it", {
        error: error.message,
      }).pipe(Effect.as({ _tag: "admitted" } as AttemptOutcome)),
    ),
  );
  switch (outcome._tag) {
    case "admitted":
      return { _tag: "admitted" } as const;
    case "waiting":
      return { _tag: "waiting", status: memoryWaitStatus(probe, outcome.position) } as const;
    case "expired":
      return {
        _tag: "expired",
        message:
          probe === undefined
            ? "Not started: the machine did not have memory for another agent in time. Retry once a running agent finishes."
            : `Not started: the machine does not have memory for another agent (${memoryStatus(probe)}). Retry once a running agent finishes.`,
      } as const;
  }
});
