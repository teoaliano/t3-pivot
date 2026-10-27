import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as Fiber from "effect/Fiber";

import {
  type HostProcess,
  ownsUnit,
  type ReaperHost,
  stopScope,
  stopWorktreeProcesses,
  sweepOrphanScopes,
} from "./scopeReaper.ts";

const proc = (pid: number, over: Partial<HostProcess> = {}): HostProcess => ({
  pid,
  ppid: 1,
  command: over.program ?? `cmd-${pid}`,
  program: `cmd-${pid}`,
  cwd: null,
  unit: null,
  startTime: pid,
  ...over,
});

/** A fake process table. `stubborn` pids ignore SIGTERM. */
const fakeHost = (initial: ReadonlyArray<HostProcess>, stubborn: ReadonlyArray<number> = []) => {
  let table = [...initial];
  const signals: Array<string> = [];
  const host: ReaperHost = {
    snapshot: Effect.sync(() => table),
    signal: (pid, signal) =>
      Effect.sync(() => {
        signals.push(`${signal} ${pid}`);
        if (signal === "SIGKILL" || !stubborn.includes(pid)) {
          table = table.filter((entry) => entry.pid !== pid);
        }
      }),
  };
  return { host, signals };
};

const OWNER = "0a1b2c3d";
const SERVER = 7;
const unit = (name: string, id: string, owner = OWNER) => `t3code-${name}-${owner}-${id}.scope`;
// The agent itself: the server spawned it, whatever its binary is called.
const agent = (pid: number, scope: string) =>
  proc(pid, { program: "/opt/claude-code/bin/claude.exe", unit: scope, ppid: SERVER });

describe("ownsUnit", () => {
  it("matches only this server's tagged units", () => {
    assert.isTrue(ownsUnit(OWNER, unit("claude", "aaaa1111")));
    assert.isTrue(ownsUnit(OWNER, unit("terminal", "aaaa1111")));
    assert.isTrue(ownsUnit(OWNER, unit("claude", "aaaa1111"), "claude"));
    assert.isFalse(ownsUnit(OWNER, unit("terminal", "aaaa1111"), "claude"));
    assert.isFalse(ownsUnit(OWNER, unit("claude", "aaaa1111", "ffffffff")));
    assert.isFalse(ownsUnit(OWNER, "t3code-claude-aaaa1111.scope"));
    assert.isFalse(ownsUnit("", "t3code-claude--aaaa1111.scope"));
  });
});

describe("sweepOrphanScopes", () => {
  it.effect("leaves a scope whose agent the server still runs alone, whatever its name", () => {
    const live = unit("claude", "aaaa1111");
    const { host, signals } = fakeHost([agent(10, live), proc(11, { unit: live, ppid: 10 })]);
    return Effect.gen(function* () {
      yield* sweepOrphanScopes(host, OWNER, SERVER);
      assert.deepStrictEqual(signals, []);
    });
  });

  it.effect("never touches another server's scopes or untagged ones", () => {
    const { host, signals } = fakeHost([
      proc(12, { unit: unit("claude", "aaaa1111", "ffffffff") }),
      proc(13, { unit: "t3code-claude-bbbb2222.scope" }),
    ]);
    return Effect.gen(function* () {
      yield* sweepOrphanScopes(host, OWNER, SERVER);
      assert.deepStrictEqual(signals, []);
    });
  });

  it.effect("stops an orphaned scope: SIGTERM first, SIGKILL for what survives", () => {
    const orphan = unit("claude", "bbbb2222");
    const { host, signals } = fakeHost(
      [
        proc(20, { unit: orphan }),
        proc(21, { unit: orphan }),
        agent(30, unit("claude", "cccc3333")),
        proc(40, { unit: unit("terminal", "dddd4444") }),
      ],
      [21],
    );
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(sweepOrphanScopes(host, OWNER, SERVER));
      yield* TestClock.adjust("6 seconds");
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(signals, ["SIGTERM 20", "SIGTERM 21", "SIGKILL 21"]);
    });
  });
});

describe("stopProcesses", () => {
  it.effect("never SIGKILLs a new process that reused a stopped one's pid", () => {
    const scope = unit("claude", "eeee5555");
    let table: Array<HostProcess> = [proc(70, { unit: scope, startTime: 100 })];
    const signals: Array<string> = [];
    const host: ReaperHost = {
      snapshot: Effect.sync(() => table),
      signal: (pid, signal) =>
        Effect.sync(() => {
          signals.push(`${signal} ${pid}`);
          // The process exits and an unrelated one takes its pid at once.
          table = [proc(70, { startTime: 900 })];
        }),
    };
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(stopScope(host, scope, "test"));
      yield* TestClock.adjust("6 seconds");
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(signals, ["SIGTERM 70"]);
    });
  });
});

describe("stopScope", () => {
  it.effect("stops only the processes in that scope", () => {
    const { host, signals } = fakeHost([
      proc(1, { unit: unit("claude", "aaaa0001") }),
      proc(2, { unit: unit("claude", "aaaa0002") }),
    ]);
    return Effect.gen(function* () {
      yield* stopScope(host, unit("claude", "aaaa0001"), "test");
      assert.deepStrictEqual(signals, ["SIGTERM 1"]);
    });
  });
});

describe("stopWorktreeProcesses", () => {
  it.effect("stops this server's scoped processes inside the worktree and no others", () => {
    const wt = "/w/feature-x";
    const mine = unit("claude", "aaaa1111");
    const terminal = unit("terminal", "bbbb2222");
    const { host, signals } = fakeHost([
      proc(50, { cwd: wt, unit: mine }),
      proc(51, { cwd: `${wt}/apps/web`, unit: terminal }),
      proc(52, { cwd: "/w/feature-x-other", unit: mine }),
      proc(53, { cwd: wt, unit: unit("claude", "cccc3333", "ffffffff") }), // another server's
      proc(54, { cwd: wt }), // the user's own shell or editor
      proc(55, { cwd: null, unit: mine }),
      proc(SERVER, { cwd: wt, ppid: 1, unit: mine }), // the server itself
    ]);
    return Effect.gen(function* () {
      yield* stopWorktreeProcesses(host, { worktreePath: wt, owner: OWNER, self: SERVER });
      assert.deepStrictEqual(signals, ["SIGTERM 50", "SIGTERM 51"]);
    });
  });

  it.effect("does nothing for a relative or root worktree path", () => {
    const { host, signals } = fakeHost([proc(56, { cwd: "/", unit: unit("claude", "a1") })]);
    return Effect.gen(function* () {
      for (const worktreePath of ["", "/", "relative/wt"]) {
        yield* stopWorktreeProcesses(host, { worktreePath, owner: OWNER, self: SERVER });
      }
      assert.deepStrictEqual(signals, []);
    });
  });
});
