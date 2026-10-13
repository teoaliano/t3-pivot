// @effect-diagnostics globalDate:off -- the fake lock directory's mtime is a plain Date.
import { describe, expect, it } from "@effect/vitest";
import type { MemoryProbe } from "@t3tools/shared/AgentScope";
import { AgentMemoryWaitError } from "@t3tools/shared/AgentScope";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import {
  admitAgent,
  memoryWaitStatus,
  parseQueue,
  queuedThreads,
  tryAdmit,
  type AdmissionQueue,
} from "./agentAdmission.ts";

const timing = { spacingMs: 30_000, staleMs: 60 * 60_000 };
const free: MemoryProbe = { state: "ok", currentBytes: 2e9, highBytes: 9e9, psiSomeAvg10: 0 };
const GiB = 1024 ** 3;
const starved: MemoryProbe = {
  state: "starved",
  currentBytes: 9.7 * GiB,
  highBytes: 9.4 * GiB,
  psiSomeAvg10: 20,
};

const empty: AdmissionQueue = { tickets: [], lastAdmittedAt: undefined };

describe("tryAdmit", () => {
  it("starts an agent at once when memory is free and nobody waits", () => {
    const result = tryAdmit(empty, { id: "a", threadId: "t1", now: 0, memoryFree: true, timing });
    expect(result.admitted).toBe(true);
    expect(result.queue.tickets).toEqual([]);
    expect(result.queue.lastAdmittedAt).toBe(0);
  });

  it("queues an agent while memory is short, and keeps it queued", () => {
    const result = tryAdmit(empty, { id: "a", threadId: "t1", now: 5, memoryFree: false, timing });
    expect(result.admitted).toBe(false);
    expect(result.queue.tickets).toEqual([{ id: "a", threadId: "t1", queuedAt: 5, waited: true }]);
  });

  it("starts queued agents in arrival order, and spaces out ones that waited", () => {
    let queue = tryAdmit(empty, {
      id: "a",
      threadId: "t1",
      now: 0,
      memoryFree: false,
      timing,
    }).queue;
    queue = tryAdmit(queue, { id: "b", threadId: "t2", now: 1, memoryFree: true, timing }).queue;
    // Memory is back, but "b" is not first in line.
    expect(
      tryAdmit(queue, { id: "b", threadId: "t2", now: 2, memoryFree: true, timing }).admitted,
    ).toBe(false);

    const first = tryAdmit(queue, { id: "a", threadId: "t1", now: 3, memoryFree: true, timing });
    expect(first.admitted).toBe(true);
    // "b" must wait for memory to show up before the next start.
    const soon = tryAdmit(first.queue, {
      id: "b",
      threadId: "t2",
      now: 3 + 1_000,
      memoryFree: true,
      timing,
    });
    expect(soon.admitted).toBe(false);
    const later = tryAdmit(first.queue, {
      id: "b",
      threadId: "t2",
      now: 3 + timing.spacingMs,
      memoryFree: true,
      timing,
    });
    expect(later.admitted).toBe(true);
  });

  it("drops tickets from a server that is gone", () => {
    const queue: AdmissionQueue = {
      tickets: [{ id: "old", threadId: "gone", queuedAt: 0, waited: true }],
      lastAdmittedAt: undefined,
    };
    const result = tryAdmit(queue, {
      id: "new",
      threadId: "t",
      now: timing.staleMs + 1,
      memoryFree: true,
      timing,
    });
    expect(result.admitted).toBe(true);
    expect(result.queue.tickets).toEqual([]);
  });
});

describe("parseQueue", () => {
  it("treats a damaged queue file as empty", () => {
    expect(parseQueue("{not json")).toEqual(empty);
    expect(parseQueue('{"tickets":"nope"}')).toEqual(empty);
  });
});

describe("memoryWaitStatus", () => {
  it("says what the agents use against their limit", () => {
    expect(memoryWaitStatus(starved)).toBe("Waiting for memory: agents use 9.7 of 9.4 GB");
  });
});

const admission = (input: {
  readonly fs: FileSystem.FileSystem;
  readonly queuePath: string;
  readonly ticketId: string;
  readonly threadId: string;
  readonly probe: Effect.Effect<MemoryProbe | undefined>;
  readonly timeoutMs?: number;
}) =>
  admitAgent({
    fs: input.fs,
    queuePath: input.queuePath,
    ticketId: input.ticketId,
    threadId: input.threadId,
    probe: input.probe,
    timing,
    timeoutMs: input.timeoutMs ?? 600_000,
    pollMs: 2_000,
  });

const QUEUE_PATH = "/run/user/1/t3code-agent-admission.json";

// The queue is files and directories, but real file I/O runs outside the test
// clock, so an in-memory file system keeps each step ordered by the clock alone.
const memoryFileSystem = () => {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const systemError = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
    PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });
  return FileSystem.layerNoop({
    readFileString: (path) =>
      files.has(path)
        ? Effect.succeed(files.get(path) ?? "")
        : Effect.fail(systemError("NotFound", "readFileString", path)),
    writeFileString: (path, data) =>
      Effect.sync(() => {
        files.set(path, data);
      }),
    makeDirectory: (path) =>
      directories.has(path)
        ? Effect.fail(systemError("AlreadyExists", "makeDirectory", path))
        : Effect.sync(() => {
            directories.add(path);
          }),
    stat: (path) =>
      directories.has(path)
        ? Effect.succeed({ mtime: Option.some(new Date(0)) } as FileSystem.File.Info)
        : Effect.fail(systemError("NotFound", "stat", path)),
    remove: (path) =>
      Effect.sync(() => {
        directories.delete(path);
        files.delete(path);
      }),
  });
};

const withQueueDir = <A, E>(
  body: (queuePath: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
) => body(QUEUE_PATH).pipe(Effect.provide(memoryFileSystem()));

describe("admitAgent", () => {
  it.effect("lets two Pivots on different projects share one queue, first in first out", () =>
    withQueueDir((queuePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const memory = yield* Ref.make<MemoryProbe | undefined>(starved);
        const probe = Ref.get(memory);
        // Two servers, each with its own project, queue on the same file.
        const pivotA = yield* Effect.forkChild(
          admission({ fs, queuePath, ticketId: "a", threadId: "project-one", probe }),
        );
        yield* TestClock.adjust("2 seconds");
        const pivotB = yield* Effect.forkChild(
          admission({ fs, queuePath, ticketId: "b", threadId: "project-two", probe }),
        );
        yield* TestClock.adjust("2 seconds");
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual(["project-one", "project-two"]);

        yield* Ref.set(memory, free);
        yield* TestClock.adjust("2 seconds");
        // "a" starts; "b" waits out the spacing, so memory shows up before it starts.
        yield* Fiber.join(pivotA);
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual(["project-two"]);
        yield* TestClock.adjust(timing.spacingMs);
        yield* Fiber.join(pivotB);
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual([]);
      }),
    ),
  );

  it.effect("fails with a memory message when the wait runs out, and leaves the queue", () =>
    withQueueDir((queuePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const waiter = yield* Effect.forkChild(
          admission({
            fs,
            queuePath,
            ticketId: "a",
            threadId: "project-one",
            probe: Effect.succeed(starved),
            timeoutMs: 10_000,
          }),
        );
        yield* TestClock.adjust("20 seconds");
        const failure = yield* Fiber.join(waiter).pipe(Effect.flip);
        expect(failure).toBeInstanceOf(AgentMemoryWaitError);
        expect(failure?.message).toContain("does not have memory");
        expect(failure?.message).toContain("agents use 9.7 of 9.4 GB");
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual([]);
      }),
    ),
  );
});
