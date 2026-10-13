import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as Fiber from "effect/Fiber";

import {
  type HostProcess,
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

const claude = (pid: number, unit: string) =>
  proc(pid, { program: "/home/u/.local/bin/claude", unit });

describe("sweepOrphanScopes", () => {
  it.effect("leaves a scope with a live claude process alone", () => {
    const { host, signals } = fakeHost([
      claude(10, "t3code-claude-aaaa1111.scope"),
      proc(11, { unit: "t3code-claude-aaaa1111.scope" }),
    ]);
    return Effect.gen(function* () {
      yield* sweepOrphanScopes(host);
      assert.deepStrictEqual(signals, []);
    });
  });

  it.effect("stops an orphaned scope: SIGTERM first, SIGKILL for what survives", () => {
    const orphan = "t3code-claude-bbbb2222.scope";
    const { host, signals } = fakeHost(
      [
        proc(20, { unit: orphan }),
        proc(21, { unit: orphan }),
        claude(30, "t3code-claude-cccc3333.scope"),
        proc(40, { unit: "t3code-terminal-dddd4444.scope" }),
      ],
      [21],
    );
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(sweepOrphanScopes(host));
      yield* TestClock.adjust("6 seconds");
      yield* Fiber.join(fiber);
      assert.deepStrictEqual(signals, ["SIGTERM 20", "SIGTERM 21", "SIGKILL 21"]);
    });
  });
});

describe("stopScope", () => {
  it.effect("stops only the processes in that scope", () => {
    const { host, signals } = fakeHost([
      proc(1, { unit: "t3code-claude-a.scope" }),
      proc(2, { unit: "t3code-claude-b.scope" }),
    ]);
    return Effect.gen(function* () {
      yield* stopScope(host, "t3code-claude-a.scope", "test");
      assert.deepStrictEqual(signals, ["SIGTERM 1"]);
    });
  });
});

describe("stopWorktreeProcesses", () => {
  it.effect("stops processes inside the worktree and no others", () => {
    const wt = "/w/pivot-x";
    const { host, signals } = fakeHost([
      proc(50, { cwd: wt }),
      proc(51, { cwd: `${wt}/apps/web` }),
      proc(52, { cwd: "/w/pivot-x-other" }),
      proc(53, { cwd: "/w/pivot-y" }),
      proc(54, { cwd: null }),
      proc(60, { cwd: wt, ppid: 1 }), // the server itself, with its cwd inside
    ]);
    return Effect.gen(function* () {
      yield* stopWorktreeProcesses(host, wt, 60);
      assert.deepStrictEqual(signals, ["SIGTERM 50", "SIGTERM 51"]);
    });
  });
});
