// @effect-diagnostics nodeBuiltinImport:off -- unit names and RAM size come from the host.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";

import {
  AgentScope,
  agentScopeCommand,
  type AgentScopeShape,
  type AgentSystemdScope,
  type MemoryProbe,
  type MemoryState,
} from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { procHost, stopScope } from "./scopeReaper.ts";
import {
  ADMISSION_FILE,
  admitAgent,
  queuedThreads,
  type AdmissionTiming,
} from "./agentAdmission.ts";

/**
 * Agents and terminals share this slice. It sits in app.slice next to the
 * server's own unit, so the server's CPUWeight and IOWeight compete with the
 * agents directly.
 */
const AGENT_SLICE = "app-t3code-agents.slice";

const GiB = 1024 ** 3;

/**
 * Memory limits for the agents slice. Agents together leave about 6 GB free
 * before they are throttled and 4 GB before the kernel kills one, so the
 * server, sshd, and tailscaled keep working. Small machines still give agents
 * at least half of RAM before throttling and three quarters before a kill.
 */
export function agentSliceMemoryLimits(totalBytes: number) {
  return {
    high: Math.max(totalBytes - 6 * GiB, Math.floor(totalBytes / 2)),
    max: Math.max(totalBytes - 4 * GiB, Math.floor(totalBytes * 0.75)),
  };
}

/** About what one teammate takes at its peak: an agent, a typecheck and a test run. */
const TEAMMATE_PEAK_BYTES = 3 * GiB;

/** How many teammates the agents slice holds at once, at a teammate's peak. */
export const teammateCapForMemory = (totalBytes: number) =>
  Math.max(1, Math.floor(agentSliceMemoryLimits(totalBytes).high / TEAMMATE_PEAK_BYTES));

/** The Pivot's teammate cap when Settings sets none: from memory on Linux, else none. */
export const defaultPivotTeammateCap = Effect.gen(function* () {
  if ((yield* HostProcess.Platform) !== "linux") return null;
  return teammateCapForMemory(NodeOS.totalmem());
});

/**
 * Each agent scope gets a share of the slice limits, so one runaway child is
 * throttled, then OOM-killed, inside its own scope before it drags the slice
 * over its limit. Terminals get the same scope, so they share the limits.
 */
export const AGENT_SCOPE_HIGH_SHARE = 0.5;
export const AGENT_SCOPE_MAX_SHARE = 0.75;

export function agentScopeMemoryLimits(
  slice: { readonly high: number; readonly max: number },
  shares: { readonly high: number; readonly max: number } = {
    high: AGENT_SCOPE_HIGH_SHARE,
    max: AGENT_SCOPE_MAX_SHARE,
  },
) {
  return {
    high: Math.floor(slice.high * shares.high),
    max: Math.floor(slice.max * shares.max),
  };
}

/** A share from the environment, kept only when it is in (0, 1]. */
export function parseMemoryShare(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const share = Number(value);
  return Number.isFinite(share) && share > 0 && share <= 1 ? share : fallback;
}

/** Share of time stalled on memory, in percent over ten seconds, that makes the machine tight. */
export const TIGHT_PRESSURE = 1;
/** Share of time stalled on memory, in percent over ten seconds, that makes it starved. */
export const STARVED_PRESSURE = 10;

/**
 * Reads `memory.current` or `memory.high`: a byte count, or undefined for `max`
 * and for anything unreadable.
 */
export function parseMemoryBytes(text: string): number | undefined {
  const value = text.trim();
  if (value === "" || value === "max") return undefined;
  const bytes = Number(value);
  return Number.isFinite(bytes) ? bytes : undefined;
}

/** The `some avg10` figure from /proc/pressure/memory, or 0 when there is none. */
export function parsePressureSomeAvg10(text: string): number {
  const some = text.split("\n").find((line) => line.startsWith("some "));
  const match = /avg10=(\d+(?:\.\d+)?)/.exec(some ?? "");
  return match === null ? 0 : Number(match[1]);
}

/**
 * Whether the slice can take one more agent. Page cache fills memory.high and
 * stays there, so headroom from memory.current alone would stall the queue for
 * good. Stalling on memory is the signal that matters: it means agents are
 * already short of memory. Being at memory.high counts only with a stall.
 */
export function classifyMemory(input: {
  readonly currentBytes: number;
  readonly highBytes: number | undefined;
  readonly psiSomeAvg10: number;
}): MemoryState {
  const atHigh = input.highBytes !== undefined && input.currentBytes >= input.highBytes;
  if (input.psiSomeAvg10 >= STARVED_PRESSURE) return "starved";
  if (atHigh && input.psiSomeAvg10 >= TIGHT_PRESSURE) return "starved";
  if (input.psiSomeAvg10 >= TIGHT_PRESSURE) return "tight";
  return "ok";
}

/** How often a start held for memory asks again; its ticket goes stale after a few misses. */
export const ADMISSION_POLL_MS = 5_000;
export const ADMISSION_TIMING: AdmissionTiming = {
  spacingMs: 30_000,
  // Generous: a deferred start is asked again only once a busy effect worker claims it.
  staleMs: 12 * ADMISSION_POLL_MS,
  timeoutMs: 10 * 60_000,
  // A teammate is background work: it waits for memory as long as the machine is busy.
  spacedTimeoutMs: 2 * 60 * 60_000,
};

export interface ScopeState {
  readonly loadState: string;
  readonly activeState: string;
  readonly result: string;
  /** `oom_kill` from the scope's memory.events, while its cgroup exists. */
  readonly oomKills: number;
  /** `populated` from the scope's cgroup.events, while its cgroup exists. */
  readonly populated: boolean | undefined;
}

/**
 * Reads one scope as the server sees it right after the agent process exits.
 * Our pipe can close before systemd handles the kill, so a scope that is
 * still stopping, is empty, or already counted an OOM kill is "stopping":
 * systemd records `Result=oom-kill` for it in a moment.
 */
export function classifyScope(state: ScopeState): "oom-killed" | "gone" | "running" | "stopping" {
  if (state.result === "oom-kill") return "oom-killed";
  if (
    state.loadState !== "loaded" ||
    state.activeState === "inactive" ||
    state.activeState === "failed"
  ) {
    return "gone";
  }
  if (state.activeState === "deactivating" || state.oomKills > 0 || state.populated === false) {
    return "stopping";
  }
  return "running";
}

function parseKeyValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) values.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  return values;
}

function parseCgroupCounter(text: string, key: string): number | undefined {
  const match = new RegExp(`^${key} (\\d+)$`, "m").exec(text);
  return match === null ? undefined : Number(match[1]);
}

const STOPPING_POLL_INTERVAL = "100 millis";
const STOPPING_POLL_ATTEMPTS = 20;
// A stopping scope can wait out TimeoutStopSec (90 s by default) for a stuck process.
const CLEAR_FAILED_INTERVAL = "1 second";
const CLEAR_FAILED_ATTEMPTS = 120;
const MAX_TRACKED_THREADS = 500;

/**
 * Names this server in its scope units, so the sweep and teardown only ever stop
 * scopes this server launched, never those of another T3 server on the machine.
 * Empty (the default) leaves units unnamed and those cleanups off.
 */
export const AgentScopeOwner = Context.Reference<string>("t3/process/AgentScopeOwner", {
  defaultValue: () => "",
});

/** The owner tag for a server's state directory: stable across restarts. */
export const agentScopeOwnerFor = (stateDir: string) =>
  NodeCrypto.createHash("sha256").update(stateDir).digest("hex").slice(0, 8);

export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  if (platform !== "linux") return AgentScope.defaultValue();

  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  const owner = yield* AgentScopeOwner;
  const layerScope = yield* Effect.scope;

  const resolve = (command: string, env: NodeJS.ProcessEnv) =>
    resolveCommandPath(command, { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Platform, platform),
    );

  const run = (command: string, args: ReadonlyArray<string>) =>
    runner.run({ command, args, timeout: "5 seconds" }).pipe(Effect.option);

  // Runs once, on the first agent launch. It proves this process can reach a
  // systemd user manager, creates the agents slice, and sets its limits.
  const systemd = yield* Effect.cached(
    Effect.gen(function* () {
      const runtimeDir = hostEnvironment.XDG_RUNTIME_DIR;
      if (runtimeDir === undefined || runtimeDir.length === 0) return undefined;
      const systemdRun = yield* resolve("systemd-run", hostEnvironment);
      const systemctl = yield* resolve("systemctl", hostEnvironment);
      if (systemdRun === null || systemctl === null) return undefined;
      const probe = (options: ReadonlyArray<string>) =>
        run(systemdRun, [
          "--user",
          "--scope",
          "--quiet",
          "--collect",
          `--slice=${AGENT_SLICE}`,
          ...options,
          "--",
          "true",
        ]).pipe(Effect.map((result) => result._tag === "Some" && result.value.code === 0));
      // Stop the whole scope when the kernel kills one of its processes, and
      // record the result as oom-kill. Scopes take OOMPolicy from systemd 253;
      // older user managers still get plain scopes, without the OOM label.
      const limits = agentSliceMemoryLimits(NodeOS.totalmem());
      const scopeLimits = agentScopeMemoryLimits(limits, {
        high: parseMemoryShare(
          hostEnvironment.T3CODE_AGENT_SCOPE_MEMORY_HIGH_SHARE,
          AGENT_SCOPE_HIGH_SHARE,
        ),
        max: parseMemoryShare(
          hostEnvironment.T3CODE_AGENT_SCOPE_MEMORY_MAX_SHARE,
          AGENT_SCOPE_MAX_SHARE,
        ),
      });
      // Each option set is proven before use, so a user manager without the memory
      // controller still gets scopes, just without per-scope limits.
      const oomOptions = ["--property=OOMPolicy=stop"];
      const memoryOptions = [
        `--property=MemoryHigh=${scopeLimits.high}`,
        `--property=MemoryMax=${scopeLimits.max}`,
      ];
      let scopeOptions: ReadonlyArray<string> | undefined;
      for (const candidate of [[...oomOptions, ...memoryOptions], oomOptions, memoryOptions, []]) {
        if (yield* probe(candidate)) {
          scopeOptions = candidate;
          break;
        }
      }
      if (scopeOptions === undefined) {
        yield* Effect.logInfo("Agent scopes are off: no systemd user manager");
        return undefined;
      }
      const limited = yield* run(systemctl, [
        "--user",
        "set-property",
        "--runtime",
        AGENT_SLICE,
        `MemoryHigh=${limits.high}`,
        `MemoryMax=${limits.max}`,
      ]);
      if (limited._tag === "None" || limited.value.code !== 0) {
        yield* Effect.logWarning("Could not set memory limits on the agents slice", {
          stderr: limited._tag === "Some" ? limited.value.stderr.trim() : undefined,
        });
      }
      const shown = yield* run(systemctl, [
        "--user",
        "show",
        AGENT_SLICE,
        "--property=ControlGroup",
      ]);
      const sliceCgroup =
        shown._tag === "Some" && shown.value.code === 0
          ? (parseKeyValues(shown.value.stdout).get("ControlGroup") ?? "")
          : "";
      yield* Effect.logInfo("Agent scopes are on", {
        slice: AGENT_SLICE,
        ...limits,
        scope: scopeLimits,
        oomPolicy: scopeOptions.includes(oomOptions[0]!),
        scopeMemoryLimits: scopeOptions.includes(memoryOptions[0]!),
      });
      return {
        systemdRun,
        systemctl,
        runtimeDir,
        scopeOptions,
        sliceCgroup,
      };
    }),
  );

  // The newest scope per thread, oldest thread first. A thread runs one agent
  // at a time, so only its latest scope can explain a failure.
  const scopeByThread = new Map<string, { unit: string; oomKilled: boolean }>();

  const readCgroupFile = (controlGroup: string, file: string) =>
    fileSystem
      .readFileString(path.join("/sys/fs/cgroup", controlGroup, file))
      .pipe(Effect.orElseSucceed(() => ""));

  // The slice's cgroup exists only while something runs in it, so an empty answer is asked
  // again on the next read instead of being kept for the life of the server.
  let sliceCgroup = "";
  const resolveSliceCgroup = (scope: {
    readonly systemctl: string;
    readonly sliceCgroup: string;
  }) =>
    Effect.gen(function* () {
      if (sliceCgroup === "") sliceCgroup = scope.sliceCgroup;
      if (sliceCgroup !== "") return sliceCgroup;
      const shown = yield* run(scope.systemctl, [
        "--user",
        "show",
        AGENT_SLICE,
        "--property=ControlGroup",
      ]);
      if (shown._tag === "Some" && shown.value.code === 0) {
        sliceCgroup = parseKeyValues(shown.value.stdout).get("ControlGroup") ?? "";
      }
      return sliceCgroup;
    });

  // Reads the agents slice's memory; undefined when the slice has no cgroup to read. Pressure
  // is the slice's own, so a browser swapping outside it does not hold agents back.
  const readMemory = (cgroup: string) =>
    Effect.gen(function* () {
      if (cgroup === "") return undefined;
      const currentBytes = parseMemoryBytes(yield* readCgroupFile(cgroup, "memory.current"));
      if (currentBytes === undefined) return undefined;
      const highBytes = parseMemoryBytes(yield* readCgroupFile(cgroup, "memory.high"));
      const slicePressure = yield* readCgroupFile(cgroup, "memory.pressure");
      const pressure =
        slicePressure !== ""
          ? slicePressure
          : yield* fileSystem
              .readFileString("/proc/pressure/memory")
              .pipe(Effect.orElseSucceed(() => ""));
      const psiSomeAvg10 = parsePressureSomeAvg10(pressure);
      return {
        state: classifyMemory({ currentBytes, highBytes, psiSomeAvg10 }),
        currentBytes,
        highBytes,
        psiSomeAvg10,
      } satisfies MemoryProbe;
    });

  const readScope = (systemctl: string, unit: string) =>
    Effect.gen(function* () {
      const shown = yield* run(systemctl, [
        "--user",
        "show",
        unit,
        "--property=LoadState,ActiveState,Result,ControlGroup",
      ]);
      // A failed query says nothing about the scope; the caller keeps the unit.
      if (shown._tag === "None" || shown.value.code !== 0) return undefined;
      const values = parseKeyValues(shown.value.stdout);
      const controlGroup = values.get("ControlGroup") ?? "";
      const memoryEvents = controlGroup ? yield* readCgroupFile(controlGroup, "memory.events") : "";
      const cgroupEvents = controlGroup ? yield* readCgroupFile(controlGroup, "cgroup.events") : "";
      const populated = parseCgroupCounter(cgroupEvents, "populated");
      return {
        loadState: values.get("LoadState") ?? "",
        activeState: values.get("ActiveState") ?? "",
        result: values.get("Result") ?? "",
        oomKills: parseCgroupCounter(memoryEvents, "oom_kill") ?? 0,
        populated: populated === undefined ? undefined : populated === 1,
      } satisfies ScopeState;
    });

  const clearFailed = (systemctl: string, unit: string) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < CLEAR_FAILED_ATTEMPTS; attempt++) {
        const state = yield* readScope(systemctl, unit);
        if (state === undefined) return;
        if (state.activeState === "failed") {
          yield* run(systemctl, ["--user", "reset-failed", unit]);
          return;
        }
        if (state.activeState !== "deactivating") return;
        yield* Effect.sleep(CLEAR_FAILED_INTERVAL);
      }
    });

  // Failed scopes stay loaded so we can read their result. Clear them once
  // systemd finishes stopping them.
  const forget = (systemctl: string, unit: string) =>
    clearFailed(systemctl, unit).pipe(Effect.forkIn(layerScope), Effect.asVoid);

  // Drops the oldest thread's scope once it has ended. A scope that still
  // runs moves to the back, so its thread keeps its OOM answer and cleanup.
  const evictOldest = (systemctl: string) =>
    Effect.gen(function* () {
      const oldest = scopeByThread.entries().next();
      if (oldest.done === true) return;
      const [threadId, tracked] = oldest.value;
      const state = yield* readScope(systemctl, tracked.unit);
      // A newer launch replaced it while we read, and forgets it itself.
      if (scopeByThread.get(threadId) !== tracked) return;
      scopeByThread.delete(threadId);
      const status = state === undefined ? "running" : classifyScope(state);
      if (status === "running" || status === "stopping") {
        scopeByThread.set(threadId, tracked);
        return;
      }
      yield* forget(systemctl, tracked.unit);
    });

  // Records a thread's newest scope, or forgets the thread when `unit` is
  // undefined. The replaced scope has its failed state cleared.
  const track = (systemctl: string, threadId: string, unit: string | undefined) =>
    Effect.gen(function* () {
      const previous = scopeByThread.get(threadId);
      scopeByThread.delete(threadId);
      if (unit !== undefined) scopeByThread.set(threadId, { unit, oomKilled: false });
      if (previous !== undefined) yield* forget(systemctl, previous.unit);
      if (scopeByThread.size > MAX_TRACKED_THREADS) yield* evictOldest(systemctl);
    });

  const oomKilled: AgentScopeShape["oomKilled"] = (threadId) =>
    Effect.gen(function* () {
      const tracked = scopeByThread.get(threadId);
      if (tracked === undefined) return false;
      if (tracked.oomKilled) return true;
      const scope = yield* systemd;
      if (scope === undefined) return false;
      for (let attempt = 0; attempt < STOPPING_POLL_ATTEMPTS; attempt++) {
        const state = yield* readScope(scope.systemctl, tracked.unit);
        if (state === undefined) return false;
        const status = classifyScope(state);
        if (status === "running") return false;
        if (status === "stopping") {
          yield* Effect.sleep(STOPPING_POLL_INTERVAL);
          continue;
        }
        yield* forget(scope.systemctl, tracked.unit);
        if (status === "gone") return false;
        yield* Effect.logWarning("Agent scope was killed: out of memory", {
          threadId,
          unit: tracked.unit,
        });
        tracked.oomKilled = true;
        return true;
      }
      return false;
    });

  const memory: AgentScopeShape["memory"] = () =>
    Effect.gen(function* () {
      const scope = yield* systemd;
      return scope === undefined ? undefined : yield* readMemory(yield* resolveSliceCgroup(scope));
    });

  // Names this server's writes to the shared queue, so its lock is never released by another.
  const admissionToken = NodeCrypto.randomUUID();

  const admit: AgentScopeShape["admit"] = (input) =>
    Effect.gen(function* () {
      const scope = yield* systemd;
      if (scope === undefined) return { _tag: "admitted" } as const;
      return yield* admitAgent({
        fs: fileSystem,
        queuePath: path.join(scope.runtimeDir, ADMISSION_FILE),
        token: admissionToken,
        ticketId: input.ticketId,
        threadId: input.threadId,
        spaced: input.spaced,
        probe: Effect.flatMap(resolveSliceCgroup(scope), readMemory),
        timing: ADMISSION_TIMING,
      });
    });

  const queuedThreadIds: AgentScopeShape["queuedThreadIds"] = () =>
    Effect.gen(function* () {
      const scope = yield* systemd;
      if (scope === undefined) return new Set<string>();
      return yield* queuedThreads(
        fileSystem,
        path.join(scope.runtimeDir, ADMISSION_FILE),
        yield* Clock.currentTimeMillis,
        ADMISSION_TIMING,
      );
    });

  const clear: AgentScopeShape["clear"] = (threadId) =>
    Effect.gen(function* () {
      if (!scopeByThread.has(threadId)) return;
      const scope = yield* systemd;
      if (scope !== undefined) yield* track(scope.systemctl, threadId, undefined);
    });

  const stop: AgentScopeShape["stop"] = (threadId) =>
    Effect.gen(function* () {
      const tracked = scopeByThread.get(threadId);
      if (tracked === undefined) return;
      yield* stopScope(procHost, tracked.unit, `thread ${threadId} finished`);
    });

  return {
    wrap: Effect.fn("AgentScope.wrap")(function* ({ command, args, name, threadId, env }) {
      const resolved = yield* resolve(command, env ?? hostEnvironment);
      // Leave unresolved commands alone so the spawn reports the missing binary.
      if (resolved === null) return { command, args };
      const scope = yield* systemd;
      if (scope === undefined) return agentScopeCommand({ command: resolved, args });
      const id = NodeCrypto.randomUUID().slice(0, 8);
      const unit =
        owner.length === 0 ? `t3code-${name}-${id}.scope` : `t3code-${name}-${owner}-${id}.scope`;
      if (threadId !== undefined) yield* track(scope.systemctl, threadId, unit);
      const systemdScope: AgentSystemdScope = {
        systemdRun: scope.systemdRun,
        runtimeDir: scope.runtimeDir,
        slice: AGENT_SLICE,
        unit,
        // Without a thread nothing reads the result, so let systemd unload
        // the unit even when it fails.
        options: threadId === undefined ? [...scope.scopeOptions, "--collect"] : scope.scopeOptions,
      };
      return agentScopeCommand({ command: resolved, args, scope: systemdScope });
    }),
    oomKilled,
    clear,
    stop,
    admit,
    memory,
    queuedThreadIds,
  } satisfies AgentScopeShape;
});

export const layer = Layer.effect(AgentScope, make).pipe(Layer.provide(ProcessRunner.layer));

/** Names this server's scope units after its state directory. */
export const layerOwner = Layer.effect(
  AgentScopeOwner,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return agentScopeOwnerFor(config.stateDir);
  }),
);
