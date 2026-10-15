// @effect-diagnostics nodeBuiltinImport:off -- fake systemd binaries live in a temp dir.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  agentScopeMemoryLimits,
  agentSliceMemoryLimits,
  teammateCapForMemory,
  classifyMemory,
  classifyScope,
  make,
  ownedAgentSlice,
  parseMemoryBytes,
  parseMemoryShare,
  parsePressureSomeAvg10,
  type ScopeState,
} from "./agentScope.ts";

const GiB = 1024 ** 3;

const running: ScopeState = {
  loadState: "loaded",
  activeState: "active",
  result: "success",
  oomKills: 0,
  populated: true,
};

describe("classifyScope", () => {
  it("reports an OOM kill only once systemd records it", () => {
    expect(classifyScope({ ...running, activeState: "failed", result: "oom-kill" })).toBe(
      "oom-killed",
    );
    // The agent pipe can close before systemd handles the kill.
    expect(classifyScope({ ...running, oomKills: 1 })).toBe("stopping");
    expect(classifyScope({ ...running, populated: false })).toBe("stopping");
    expect(classifyScope({ ...running, activeState: "deactivating" })).toBe("stopping");
  });

  it("does not wait on a live agent or a scope that ended for another reason", () => {
    expect(classifyScope(running)).toBe("running");
    expect(classifyScope({ ...running, activeState: "inactive", populated: undefined })).toBe(
      "gone",
    );
    expect(classifyScope({ ...running, loadState: "not-found", activeState: "inactive" })).toBe(
      "gone",
    );
  });
});

describe("agentSliceMemoryLimits", () => {
  it("leaves 6 GB before throttling and 4 GB before a kill on large machines", () => {
    expect(agentSliceMemoryLimits(64 * GiB)).toEqual({ high: 58 * GiB, max: 60 * GiB });
  });

  it("still gives agents most of a small machine", () => {
    expect(agentSliceMemoryLimits(8 * GiB)).toEqual({ high: 4 * GiB, max: 6 * GiB });
  });
});

describe("teammateCapForMemory", () => {
  it("fits a teammate's peak into the agents' memory, and allows at least one", () => {
    // Homebox: 14 GB leaves 8 GB before throttling, so two teammates at 3 GB each.
    expect(teammateCapForMemory(14 * GiB)).toBe(2);
    expect(teammateCapForMemory(64 * GiB)).toBe(19);
    expect(teammateCapForMemory(4 * GiB)).toBe(1);
  });
});

describe("agentScopeMemoryLimits", () => {
  it("gives each scope half of the slice's high mark and three quarters of its max", () => {
    const slice = agentSliceMemoryLimits(14 * GiB);
    expect(agentScopeMemoryLimits(slice)).toEqual({
      high: Math.floor(slice.high / 2),
      max: Math.floor((slice.max * 3) / 4),
    });
    expect(agentScopeMemoryLimits(slice).max).toBeLessThan(slice.max);
  });

  it("takes configured shares, and ignores one outside (0, 1]", () => {
    expect(parseMemoryShare("0.25", 0.5)).toBe(0.25);
    expect(parseMemoryShare("1", 0.5)).toBe(1);
    expect(parseMemoryShare("0", 0.5)).toBe(0.5);
    expect(parseMemoryShare("1.5", 0.5)).toBe(0.5);
    expect(parseMemoryShare("lots", 0.5)).toBe(0.5);
    expect(parseMemoryShare(undefined, 0.5)).toBe(0.5);
  });
});

describe("memory probe readers", () => {
  it("reads a cgroup byte count, and treats max or junk as no limit", () => {
    expect(parseMemoryBytes("9663676416\n")).toBe(9663676416);
    expect(parseMemoryBytes("max\n")).toBeUndefined();
    expect(parseMemoryBytes("")).toBeUndefined();
  });

  it("reads the some avg10 line of /proc/pressure/memory", () => {
    const fixture = [
      "some avg10=12.34 avg60=8.00 avg300=2.10 total=1234567",
      "full avg10=4.56 avg60=1.00 avg300=0.40 total=765432",
      "",
    ].join("\n");
    expect(parsePressureSomeAvg10(fixture)).toBe(12.34);
    expect(parsePressureSomeAvg10("")).toBe(0);
  });
});

describe("classifyMemory", () => {
  const GB = 1e9;

  it("is ok while nothing stalls, even with the page cache filling memory.high", () => {
    expect(classifyMemory({ currentBytes: 6 * GB, highBytes: 9.35 * GB, psiSomeAvg10: 0 })).toBe(
      "ok",
    );
    // Cache at the high mark is not a shortage until something stalls.
    expect(classifyMemory({ currentBytes: 9.35 * GB, highBytes: 9.35 * GB, psiSomeAvg10: 0 })).toBe(
      "ok",
    );
  });

  it("is tight once agents start stalling on memory", () => {
    expect(classifyMemory({ currentBytes: 6 * GB, highBytes: 9.35 * GB, psiSomeAvg10: 2 })).toBe(
      "tight",
    );
  });

  it("is starved when the slice sits at memory.high and stalls, as in three typechecks", () => {
    expect(classifyMemory({ currentBytes: 9.7 * GB, highBytes: 9.35 * GB, psiSomeAvg10: 3 })).toBe(
      "starved",
    );
  });

  it("is starved on heavy stalls alone, and without a high mark", () => {
    expect(classifyMemory({ currentBytes: 2 * GB, highBytes: undefined, psiSomeAvg10: 15 })).toBe(
      "starved",
    );
  });
});

// Runs the real service against a fake user manager. `units` holds the
// ActiveState and Result that `systemctl show` reports for each scope or
// slice, and `calls` records every command in order.
const withFakeSystemd = <A, E>(
  body: (input: {
    readonly scope: Effect.Success<typeof make>;
    readonly units: Map<string, { activeState: string; result: string }>;
    readonly calls: ReadonlyArray<ReadonlyArray<string>>;
    readonly stateDir: string;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-agent-scope-"));
    for (const name of ["systemd-run", "systemctl", "agent"]) {
      NodeFS.writeFileSync(NodePath.join(bin, name), "", { mode: 0o755 });
    }
    const units = new Map<string, { activeState: string; result: string }>();
    const calls: Array<ReadonlyArray<string>> = [];
    const output = (stdout: string): ProcessRunner.ProcessRunOutput => ({
      stdout,
      stderr: "",
      code: ChildProcessSpawner.ExitCode(0),
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    });
    const runner = ProcessRunner.ProcessRunner.of({
      run: ({ args }) =>
        Effect.sync(() => {
          calls.push(args);
          const [, verb, unit = ""] = args;
          if (verb === "reset-failed") units.delete(unit);
          if (verb !== "show") return output("");
          const state = units.get(unit);
          return output(
            state === undefined
              ? "LoadState=not-found\nActiveState=inactive\nResult=success\n"
              : `LoadState=loaded\nActiveState=${state.activeState}\nResult=${state.result}\n`,
          );
        }),
    });
    const scope = yield* make.pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { PATH: bin, XDG_RUNTIME_DIR: "/run/user/1" }),
    );
    const { stateDir } = yield* ServerConfig.ServerConfig;
    return yield* body({ scope, units, calls, stateDir }).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(bin, { recursive: true, force: true }))),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-agent-scope-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const unitOf = (launch: { readonly args: ReadonlyArray<string> }) =>
  launch.args.find((arg) => arg.startsWith("--unit="))?.slice("--unit=".length) ?? "";

const sliceOf = (launch: { readonly args: ReadonlyArray<string> }) =>
  launch.args.find((arg) => arg.startsWith("--slice="))?.slice("--slice=".length) ?? "";

describe("AgentScope service", () => {
  it.effect("labels a thread from its newest scope until its next session clears it", () =>
    withFakeSystemd(({ scope, units }) =>
      Effect.gen(function* () {
        const first = yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: "a" });
        units.set(unitOf(first), { activeState: "failed", result: "oom-kill" });
        const second = yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: "a" });
        units.set(unitOf(second), { activeState: "active", result: "success" });
        // The older scope was OOM-killed, but the newest one is still running.
        expect(yield* scope.oomKilled("a")).toBe(false);

        units.set(unitOf(second), { activeState: "failed", result: "oom-kill" });
        expect(yield* scope.oomKilled("a")).toBe(true);
        // A retried failure reads the same, even after the failed unit is reset.
        units.delete(unitOf(second));
        expect(yield* scope.oomKilled("a")).toBe(true);

        // The next session may run without a scope, for example on Cursor.
        yield* scope.clear("a");
        expect(yield* scope.oomKilled("a")).toBe(false);
      }),
    ),
  );

  it.effect(
    "limits each agent scope inside the slice, so one runaway child stays in its scope",
    () =>
      withFakeSystemd(({ scope }) =>
        Effect.gen(function* () {
          const launch = yield* scope.wrap({
            command: "agent",
            args: [],
            name: "t",
            threadId: "a",
          });
          const limits = agentScopeMemoryLimits(agentSliceMemoryLimits(NodeOS.totalmem()));
          expect(launch.args).toContain(`--property=MemoryHigh=${limits.high}`);
          expect(launch.args).toContain(`--property=MemoryMax=${limits.max}`);
        }),
      ),
  );

  it.effect("keeps a running scope while hundreds of other threads launch", () =>
    withFakeSystemd(({ scope, units }) =>
      Effect.gen(function* () {
        const live = yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: "live" });
        units.set(unitOf(live), { activeState: "active", result: "success" });
        for (let index = 0; index < 600; index++) {
          yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: `other-${index}` });
        }
        units.set(unitOf(live), { activeState: "failed", result: "oom-kill" });
        expect(yield* scope.oomKilled("live")).toBe(true);
      }),
    ),
  );

  it.effect("stops agents a killed server left before the first launch", () =>
    withFakeSystemd(({ scope, units, calls, stateDir }) =>
      Effect.gen(function* () {
        units.set(ownedAgentSlice(stateDir), { activeState: "active", result: "success" });
        const agent = yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: "a" });
        const stops = calls.filter(([, verb]) => verb === "stop");
        expect(stops).toEqual([["--user", "stop", ownedAgentSlice(stateDir)]]);
        // Agents run in this server's own slice; terminals stay outside it.
        expect(sliceOf(agent)).toBe(ownedAgentSlice(stateDir));
        // An agent that ignores SIGTERM is killed well inside the stop's wait.
        expect(agent.args).toContain("--property=TimeoutStopSec=10s");
        const terminal = yield* scope.wrap({
          command: "agent",
          args: [],
          name: "terminal",
          survivesRestart: true,
        });
        expect(sliceOf(terminal)).toBe("app-t3code-agents.slice");
        // Only the first launch looks for leftovers.
        expect(calls.filter(([, verb]) => verb === "stop")).toHaveLength(1);
      }),
    ),
  );

  it.effect("leaves a quiet slice alone", () =>
    withFakeSystemd(({ scope, calls }) =>
      Effect.gen(function* () {
        yield* scope.wrap({ command: "agent", args: [], name: "t", threadId: "a" });
        expect(calls.filter(([, verb]) => verb === "stop")).toEqual([]);
      }),
    ),
  );
});
