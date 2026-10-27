// @effect-diagnostics globalDate:off -- the fake lock directory's mtime is a plain Date.
import { describe, expect, it } from "@effect/vitest";
import type { MemoryProbe, MemoryState } from "@t3tools/shared/AgentScope";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";

import {
  admitAgent,
  memoryWaitStatus,
  parseQueue,
  queuedThreads,
  tryAdmit,
  type AdmissionQueue,
} from "./agentAdmission.ts";

const timing = {
  staleMs: 20_000,
  timeoutMs: 600_000,
};
const free: MemoryProbe = { state: "ok", currentBytes: 2e9, highBytes: 9e9, psiSomeAvg10: 0 };
const GiB = 1024 ** 3;
const starved: MemoryProbe = {
  state: "starved",
  currentBytes: 9.7 * GiB,
  highBytes: 9.4 * GiB,
  psiSomeAvg10: 20,
};

const empty: AdmissionQueue = { tickets: [] };

const attempt = (
  queue: AdmissionQueue,
  input: { id: string; now: number; memory: MemoryState | undefined },
) =>
  tryAdmit(queue, {
    id: input.id,
    threadId: `thread-${input.id}`,
    now: input.now,
    memory: input.memory,
    timing,
  });

describe("tryAdmit", () => {
  it("starts an agent at once unless memory is starved, without touching the line", () => {
    for (const memory of ["ok", "tight", undefined] as const) {
      const result = attempt(empty, { id: "a", now: 0, memory });
      expect(result.outcome).toEqual({ _tag: "admitted" });
      expect(result.queue.tickets).toEqual([]);
    }
    const held = attempt(empty, { id: "a", now: 5, memory: "starved" });
    expect(held.outcome).toEqual({ _tag: "waiting", position: 1 });
    expect(held.queue.tickets.map((ticket) => ticket.id)).toEqual(["a"]);
  });

  it("drops a ticket whose caller stopped asking, so nobody waits behind it", () => {
    const queue = attempt(empty, { id: "gone", now: 0, memory: "starved" }).queue;
    const next = attempt(queue, { id: "b", now: timing.staleMs + 1, memory: "ok" });
    expect(next.outcome._tag).toBe("admitted");
    expect(next.queue.tickets).toEqual([]);
  });

  it("keeps a start's place in line while its caller keeps asking", () => {
    const ask = (queue: AdmissionQueue, id: string, now: number) =>
      attempt(queue, { id, now, memory: "starved" }).queue;
    let queue = ask(ask(empty, "a", 0), "b", 1);
    for (let now = 5_000; now < 60_000; now += 5_000) queue = ask(ask(queue, "a", now), "b", now);
    expect(queue.tickets.map((ticket) => ticket.id)).toEqual(["a", "b"]);
    expect(attempt(queue, { id: "b", now: 60_000, memory: "starved" }).outcome).toEqual({
      _tag: "waiting",
      position: 2,
    });
  });

  it("starts a user's agent once memory is fine, whoever waits ahead of it", () => {
    // An earlier start is stuck at the head (stopped, not yet stale).
    const queue = attempt(empty, { id: "stuck", now: 0, memory: "starved" }).queue;
    expect(attempt(queue, { id: "chat", now: 1, memory: "ok" }).outcome._tag).toBe("admitted");
  });

  it("gives up on a start that waited past its timeout, and frees its place", () => {
    let queue = attempt(empty, { id: "a", now: 0, memory: "starved" }).queue;
    for (let now = 5_000; now < timing.timeoutMs; now += 5_000) {
      queue = attempt(queue, { id: "a", now, memory: "starved" }).queue;
    }
    const expired = attempt(queue, { id: "a", now: timing.timeoutMs, memory: "starved" });
    expect(expired.outcome._tag).toBe("expired");
    expect(expired.queue.tickets).toEqual([]);
  });
});

describe("parseQueue", () => {
  it("treats a damaged or older queue file as empty", () => {
    expect(parseQueue("{not json")).toEqual(empty);
    expect(parseQueue('{"tickets":"nope"}')).toEqual(empty);
    expect(
      parseQueue('{"tickets":[{"id":"a","queuedAt":0,"waited":true}],"lastAdmittedAt":1}'),
    ).toEqual(empty);
  });
});

describe("memoryWaitStatus", () => {
  it("says what the agents use against their limit, and the place in line", () => {
    expect(memoryWaitStatus(starved)).toBe("Waiting for memory: agents use 9.7 of 9.4 GB");
    expect(memoryWaitStatus(starved, 3)).toBe(
      "Waiting for memory: agents use 9.7 of 9.4 GB, 3 in line",
    );
    expect(memoryWaitStatus(undefined)).toBe("Waiting for memory");
  });
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
    rename: (from, to) =>
      Effect.sync(() => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
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
        for (const file of files.keys()) {
          if (file === path || file.startsWith(`${path}/`)) files.delete(file);
        }
      }),
  });
};

const withQueueDir = <A, E>(
  body: (queuePath: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
) => body(QUEUE_PATH).pipe(Effect.provide(memoryFileSystem()));

const ask = (
  fs: FileSystem.FileSystem,
  queuePath: string,
  input: { ticketId: string; token: string; probe: MemoryProbe | undefined },
) =>
  admitAgent({
    fs,
    queuePath,
    token: input.token,
    ticketId: input.ticketId,
    threadId: `thread-${input.ticketId}`,
    probe: Effect.succeed(input.probe),
    timing,
  });

describe("admitAgent", () => {
  it.effect("lets two servers share one queue in order, and says why one waits", () =>
    withQueueDir((queuePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        // Two servers queue agents on the same file.
        const start = (ticketId: string, token: string, probe: MemoryProbe) =>
          ask(fs, queuePath, { ticketId, token, probe });
        expect(yield* start("a", "one", starved)).toEqual({
          _tag: "waiting",
          status: "Waiting for memory: agents use 9.7 of 9.4 GB",
        });
        yield* TestClock.adjust("1 second");
        expect(yield* start("b", "two", starved)).toEqual({
          _tag: "waiting",
          status: "Waiting for memory: agents use 9.7 of 9.4 GB, 2 in line",
        });
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual(["thread-a", "thread-b"]);

        // Memory is back: both start.
        expect((yield* start("a", "one", free))._tag).toBe("admitted");
        expect((yield* start("b", "two", free))._tag).toBe("admitted");
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual([]);
      }),
    ),
  );

  it.effect("forgets a stopped start a few polls later, so it holds nobody back", () =>
    withQueueDir((queuePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* ask(fs, queuePath, { ticketId: "stopped", token: "one", probe: starved });
        // Its run was stopped: it never asks again.
        yield* TestClock.adjust(timing.staleMs + 1);
        expect([
          ...(yield* queuedThreads(fs, queuePath, yield* Clock.currentTimeMillis, timing)),
        ]).toEqual([]);
        expect(
          (yield* ask(fs, queuePath, { ticketId: "next", token: "two", probe: free }))._tag,
        ).toBe("admitted");
      }),
    ),
  );

  it.effect("fails with a memory message once the wait runs out", () =>
    withQueueDir((queuePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        for (let waited = 0; waited < timing.timeoutMs; waited += 5_000) {
          yield* ask(fs, queuePath, { ticketId: "a", token: "one", probe: starved });
          yield* TestClock.adjust("5 seconds");
        }
        const expired = yield* ask(fs, queuePath, { ticketId: "a", token: "one", probe: starved });
        expect(expired._tag).toBe("expired");
        expect(expired._tag === "expired" ? expired.message : "").toContain(
          "does not have memory for another agent (agents use 9.7 of 9.4 GB)",
        );
      }),
    ),
  );
});
