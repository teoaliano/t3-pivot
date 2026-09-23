/**
 * ManagedProcesses - long-running project scripts owned by a checkout.
 *
 * A checkout is a worktree, or a project's main working directory. Each one
 * reserves a block of ports for its lifetime (see PortReservations.ts), and
 * each (checkout, script) pair runs at most one process, in a T3 terminal.
 * Threads only borrow: nothing here stops a process because a thread went
 * away. The sweep stops what nobody has wanted for thirty minutes.
 *
 * The live process table is memory only. Port reservations, pins, and the
 * identity of each running listener live in one global sidecar file beside
 * the worktrees directory, so a restart keeps every block and a process that
 * outlived a killed server can be found and stopped. Nothing is event-sourced.
 * See docs/internals/managed-processes.md.
 */
import * as NodeCrypto from "node:crypto";

import {
  ManagedProcessDependenciesMissingError,
  ManagedProcessPortOccupiedError,
  ManagedProcessPortsExhaustedError,
  ManagedProcessStartError,
  type ManagedProcess,
  type ManagedProcessCheckoutSnapshot,
  type ManagedProcessStatus,
  type ManagedProcessTarget,
  type TerminalEvent,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PortDiscovery } from "../preview/PortScanner.ts";
import { forkParked } from "../serverActivation.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import {
  blockPorts,
  ensureReservation,
  reallocateReservation,
  reconcileReservations,
  releaseReservation,
  type PortRange,
  type PortReservations,
} from "./PortReservations.ts";
import { readDetectedDevScript, readMissingInstallCommand } from "./detectDevScript.ts";
import { ProcessInspector } from "./ProcessInspector.ts";

/** What to run: a project script resolved against the checkout that owns it. */
export interface ManagedScriptTarget {
  readonly checkoutPath: string;
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly script: {
    readonly id: string;
    readonly name: string;
    readonly command: string;
  };
}

export type ManagedProcessServiceStartFailure =
  | ManagedProcessDependenciesMissingError
  | ManagedProcessPortOccupiedError
  | ManagedProcessPortsExhaustedError
  | ManagedProcessStartError;

export class ManagedProcesses extends Context.Service<
  ManagedProcesses,
  {
    /**
     * Idempotent: returns the process already starting or running for this
     * checkout and script. Refuses, naming the occupant, when the reserved
     * port is held by anything else; `reallocate` moves the checkout to a
     * new block first. Refuses a checkout whose npm dependencies are not
     * installed. Starting grants no protection from the idle sweep.
     */
    readonly start: (
      target: ManagedScriptTarget,
      options?: { readonly reallocate?: boolean },
    ) => Effect.Effect<ManagedProcess, ManagedProcessServiceStartFailure>;
    /** Stops the process and waits for its reserved port to be released. */
    readonly stop: (target: ManagedProcessTarget) => Effect.Effect<void>;
    /**
     * Stops every process a checkout runs. Call before removing the checkout.
     * `releaseReservation` also frees its port block, for a checkout that is
     * gone for good rather than kept for recreation at the same path.
     */
    readonly stopAllForCheckout: (
      checkoutPath: string,
      options?: { readonly releaseReservation?: boolean },
    ) => Effect.Effect<void>;
    /** A pinned process is never stopped for being idle. Persisted. */
    readonly setPinned: (
      target: ManagedProcessTarget & { readonly pinned: boolean },
    ) => Effect.Effect<void>;
    /** Keeps the process from being reaped until the scope closes. */
    readonly borrow: (target: ManagedProcessTarget) => Effect.Effect<void, never, Scope.Scope>;
    /**
     * The checkout's processes now, then after every change, with the
     * `package.json` dev script it offers. Watching holds no claim.
     */
    readonly stream: (checkoutPath: string) => Stream.Stream<ManagedProcessCheckoutSnapshot>;
    /** Stops every process idle past the threshold that nothing exempts. */
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/managedProcess/ManagedProcesses") {}

const DEFAULT_IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const RESERVATION_RECONCILE_INTERVAL = Duration.hours(1);
/** Matches the port scanner's poll, which is where readiness comes from. */
const READINESS_POLL_INTERVAL = Duration.seconds(3);
const PORT_RELEASE_POLL_INTERVAL = Duration.millis(250);
/** Covers the terminal layer's SIGTERM grace before its own SIGKILL. */
const PORT_RELEASE_ATTEMPTS = 12;
const SERVER_PID = process.pid;

export interface ManagedProcessesOptions {
  readonly registryPath: string;
  /** Test-only overrides; the defaults are deliberate constants, not settings. */
  readonly idleThresholdMs?: number;
  readonly portRange?: PortRange;
}

const RegistryProcess = Schema.Struct({
  checkoutPath: Schema.String,
  scriptId: Schema.String,
  pid: Schema.Int,
  port: Schema.Int,
  command: Schema.String,
  /** Two servers can share the file. Only a dead server's processes are orphans. */
  serverPid: Schema.Int,
});
type RegistryProcess = typeof RegistryProcess.Type;

const RegistryFile = Schema.Struct({
  version: Schema.Literal(1),
  reservations: Schema.Record(Schema.String, Schema.Int),
  pins: Schema.Array(Schema.Struct({ checkoutPath: Schema.String, scriptId: Schema.String })),
  processes: Schema.Array(RegistryProcess),
});
type RegistryFile = typeof RegistryFile.Type;

const decodeRegistryFile = Schema.decodeUnknownEffect(Schema.fromJsonString(RegistryFile));
const encodeRegistryFile = Schema.encodeSync(Schema.fromJsonString(RegistryFile));

const emptyRegistry: RegistryFile = { version: 1, reservations: {}, pins: [], processes: [] };

interface LiveProcess {
  readonly checkoutPath: string;
  readonly scriptId: string;
  readonly scriptName: string;
  readonly status: ManagedProcessStatus;
  readonly port: number;
  readonly lastError: string | null;
  readonly terminal: { readonly threadId: string; readonly terminalId: string };
  readonly lastDemandAtMs: number;
  readonly borrowers: number;
}

interface LiveState {
  readonly processes: ReadonlyMap<string, LiveProcess>;
  readonly pins: ReadonlySet<string>;
}

const processKey = (target: ManagedProcessTarget): string =>
  `${target.checkoutPath}\u0000${target.scriptId}`;

const isLive = (managed: LiveProcess): boolean => managed.status !== "stopped";

/** Managed terminals hang off a per-checkout owner, not a thread, so deleting a thread cannot close them. */
const terminalOwnerId = (checkoutPath: string): string =>
  `managed-process:${NodeCrypto.createHash("sha256").update(checkoutPath).digest("hex").slice(0, 16)}`;

const reservationsOf = (registry: RegistryFile): PortReservations =>
  new Map(Object.entries(registry.reservations));

const withReservations = (
  registry: RegistryFile,
  reservations: PortReservations,
): RegistryFile => ({ ...registry, reservations: Object.fromEntries(reservations) });

function exitReason(event: Extract<TerminalEvent, { type: "exited" }>): string | null {
  if (event.exitCode !== null && event.exitCode !== 0) return `Exited with code ${event.exitCode}`;
  if (event.exitSignal !== null && event.exitSignal !== 0) {
    return `Stopped by signal ${event.exitSignal}`;
  }
  return null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.fn("ManagedProcesses.make")(function* (
  options: ManagedProcessesOptions,
) {
  const terminals = yield* TerminalManager;
  const discovery = yield* PortDiscovery;
  const inspector = yield* ProcessInspector;
  const backgroundPolicy = yield* BackgroundPolicy;
  const projections = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serviceScope = yield* Effect.scope;
  const platform = yield* HostProcessPlatform;

  const idleThresholdMs = Math.max(1, options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS);
  const registryLock = yield* Semaphore.make(1);
  const lifecycleLock = yield* Semaphore.make(1);

  const readRegistry = fs.readFileString(options.registryPath).pipe(
    Effect.flatMap(decodeRegistryFile),
    Effect.catchCause((cause) =>
      fs.exists(options.registryPath).pipe(
        Effect.orElseSucceed(() => false),
        Effect.flatMap((exists) =>
          exists
            ? Effect.logWarning("managed process registry is unreadable; starting empty", {
                path: options.registryPath,
                cause,
              })
            : Effect.void,
        ),
        Effect.as(emptyRegistry),
      ),
    ),
  );

  /**
   * Read-modify-write under one lock. The file is re-read each time because
   * another server sharing the base directory may have written it.
   */
  const updateRegistry = <A>(mutate: (registry: RegistryFile) => readonly [A, RegistryFile]) =>
    registryLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* readRegistry;
        const [result, next] = mutate(current);
        if (next !== current) {
          yield* writeFileStringAtomically({
            filePath: options.registryPath,
            contents: `${encodeRegistryFile(next)}\n`,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to write managed process registry", {
                path: options.registryPath,
                cause,
              }),
            ),
          );
        }
        return result;
      }),
    );

  const initialRegistry = yield* readRegistry;
  const state = yield* SubscriptionRef.make<LiveState>({
    processes: new Map(),
    pins: new Set(initialRegistry.pins.map(processKey)),
  });

  const toContract = (managed: LiveProcess, pins: ReadonlySet<string>): ManagedProcess => ({
    checkoutPath: managed.checkoutPath,
    scriptId: managed.scriptId,
    scriptName: managed.scriptName,
    status: managed.status,
    port: managed.port,
    pinned: pins.has(processKey(managed)),
    lastError: managed.lastError,
    terminal: managed.terminal,
  });

  const snapshotFor = (
    current: LiveState,
    checkoutPath: string,
  ): ManagedProcessCheckoutSnapshot => ({
    checkoutPath,
    processes: [...current.processes.values()]
      .filter((managed) => managed.checkoutPath === checkoutPath)
      .map((managed) => toContract(managed, current.pins))
      .toSorted((left, right) => left.scriptId.localeCompare(right.scriptId)),
  });

  /** Keeps the scanner's fallback probe aware of every port a live process may bind. */
  const syncDiscoveryPorts = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state);
    yield* discovery.setManagedPorts([
      ...new Set([...current.processes.values()].filter(isLive).map((managed) => managed.port)),
    ]);
  });

  const updateProcess = (key: string, mutate: (managed: LiveProcess) => LiveProcess) =>
    SubscriptionRef.update(state, (current) => {
      const existing = current.processes.get(key);
      if (!existing) return current;
      return { ...current, processes: new Map(current.processes).set(key, mutate(existing)) };
    });

  const forgetListener = (target: ManagedProcessTarget) =>
    updateRegistry((registry) => {
      const processes = registry.processes.filter(
        (entry) => processKey(entry) !== processKey(target),
      );
      return [
        undefined,
        processes.length === registry.processes.length ? registry : { ...registry, processes },
      ] as const;
    });

  /** Marks a process stopped. Returns false when it was not live, so callers act once. */
  const markStopped = (key: string, lastError: string | null) =>
    SubscriptionRef.modify(state, (current) => {
      const existing = current.processes.get(key);
      if (!existing || !isLive(existing)) return [false, current] as const;
      return [
        true,
        {
          ...current,
          processes: new Map(current.processes).set(key, {
            ...existing,
            status: "stopped",
            lastError,
            borrowers: 0,
          }),
        },
      ] as const;
    });

  // Exit watcher. A process that exits on its own stays stopped: there is no
  // restart policy, because a dev server usually exits when its code does not
  // compile, and a restart loop would hide that.
  const findByTerminal = (threadId: string, terminalId: string) =>
    SubscriptionRef.get(state).pipe(
      Effect.map((current) =>
        [...current.processes.values()].find(
          (managed) =>
            managed.terminal.threadId === threadId && managed.terminal.terminalId === terminalId,
        ),
      ),
    );
  const unsubscribeTerminals = yield* terminals.subscribe((event) => {
    if (event.type !== "exited" && event.type !== "closed") return Effect.void;
    return findByTerminal(event.threadId, event.terminalId).pipe(
      Effect.flatMap((managed) => {
        if (!managed) return Effect.void;
        return markStopped(
          processKey(managed),
          event.type === "exited" ? exitReason(event) : null,
        ).pipe(
          Effect.flatMap((stopped) =>
            stopped
              ? forgetListener(managed).pipe(Effect.andThen(syncDiscoveryPorts))
              : Effect.void,
          ),
        );
      }),
    );
  });
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribeTerminals));

  /**
   * The scanner publishes a port only once an HTTP probe gets a web page back,
   * so appearing in discovery is readiness. The listener must also be one of
   * our terminal's descendants: a stranger that took the port during boot is
   * never called ours, so it is never recorded and never reaped as an orphan.
   * Where the platform cannot name the listener, readiness alone decides.
   */
  const watchReadiness = (key: string, target: ManagedProcessTarget, port: number) =>
    Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state).pipe(
        Effect.map((latest) => latest.processes.get(key)),
      );
      if (current?.status !== "starting") return true;
      const servers = yield* discovery.scan();
      const server = servers.find((candidate) => candidate.port === port);
      if (!server) return false;
      if (server.pid !== null) {
        const pid = server.pid;
        // The terminal layer polls its process tree, so a real server can
        // show up here a scan or two after it starts answering.
        const descendants = yield* discovery.terminalProcessIds(current.terminal);
        if (!descendants.includes(pid)) return false;
        const command = yield* inspector.commandLine(pid);
        if (command !== null) {
          yield* updateRegistry((registry) => [
            undefined,
            {
              ...registry,
              processes: [
                ...registry.processes.filter((entry) => processKey(entry) !== key),
                { ...target, pid, port, command, serverPid: SERVER_PID },
              ],
            },
          ]);
        }
      }
      yield* updateProcess(key, (managed) =>
        managed.status === "starting" ? { ...managed, status: "running" } : managed,
      );
      return true;
    }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(READINESS_POLL_INTERVAL),
        until: (done) => done,
      }),
      Effect.forkIn(serviceScope),
    );

  const reserveBlock = (checkoutPath: string, reallocate: boolean) =>
    updateRegistry((registry) => {
      const current = reservationsOf(registry);
      const result = reallocate
        ? reallocateReservation(current, checkoutPath, options.portRange)
        : ensureReservation(current, checkoutPath, options.portRange);
      if (result === null) return [null, registry] as const;
      return [
        result.base,
        result.reservations === current
          ? registry
          : withReservations(registry, result.reservations),
      ] as const;
    });

  const start: ManagedProcesses["Service"]["start"] = (target, startOptions) =>
    lifecycleLock.withPermits(1)(
      Effect.gen(function* () {
        const identity = { checkoutPath: target.checkoutPath, scriptId: target.script.id };
        const key = processKey(identity);
        const current = yield* SubscriptionRef.get(state);
        const existing = current.processes.get(key);
        if (existing && isLive(existing)) {
          if (startOptions?.reallocate !== true) return toContract(existing, current.pins);
          // Moving blocks restarts the process on the new port, never beside it.
          yield* stopUnlocked(existing);
        }

        // A fresh worktree has no node_modules. Refuse with the fix rather
        // than open a terminal whose command dies a moment later.
        const installCommand = yield* readMissingInstallCommand(target.checkoutPath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
        if (installCommand !== null) {
          return yield* new ManagedProcessDependenciesMissingError({
            checkoutPath: target.checkoutPath,
            installCommand,
          });
        }

        const base = yield* reserveBlock(target.checkoutPath, startOptions?.reallocate === true);
        if (base === null) {
          return yield* new ManagedProcessPortsExhaustedError({
            checkoutPath: target.checkoutPath,
          });
        }
        const ports = blockPorts(base);

        // Never slide to another port and never stop the occupant: name it.
        const occupant = yield* discovery.listenerOn(base);
        if (Option.isSome(occupant)) {
          const { pid, processName } = occupant.value;
          return yield* new ManagedProcessPortOccupiedError({
            checkoutPath: target.checkoutPath,
            port: base,
            occupantPid: pid,
            occupantProcessName: processName,
            occupantCommand: pid === null ? null : yield* inspector.commandLine(pid),
          });
        }

        const terminal = {
          threadId: terminalOwnerId(target.checkoutPath),
          terminalId: target.script.id,
        };
        const startFailed = (cause: unknown) =>
          new ManagedProcessStartError({
            checkoutPath: target.checkoutPath,
            scriptId: target.script.id,
            cause,
          });
        yield* terminals
          .open({
            ...terminal,
            cwd: target.checkoutPath,
            worktreePath: target.worktreePath,
            env: projectScriptRuntimeEnv({
              project: { cwd: target.projectRoot },
              worktreePath: target.worktreePath,
              ports,
            }),
          })
          .pipe(Effect.mapError(startFailed));
        // `; exit` ends the shell with the script, so the terminal's exit is the process's.
        yield* terminals
          .write({ ...terminal, data: `${target.script.command}; exit\r` })
          .pipe(Effect.mapError(startFailed));

        const now = yield* Clock.currentTimeMillis;
        const started: LiveProcess = {
          checkoutPath: target.checkoutPath,
          scriptId: target.script.id,
          scriptName: target.script.name,
          status: "starting",
          port: base,
          lastError: null,
          terminal,
          lastDemandAtMs: now,
          borrowers: existing?.borrowers ?? 0,
        };
        const next = yield* SubscriptionRef.modify(state, (latest) => {
          const updated = {
            ...latest,
            processes: new Map(latest.processes).set(key, started),
          };
          return [updated, updated] as const;
        });
        yield* syncDiscoveryPorts;
        yield* watchReadiness(key, identity, base);
        return toContract(started, next.pins);
      }),
    );

  const waitForPortRelease = (port: number) =>
    discovery.listenerOn(port).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(PORT_RELEASE_POLL_INTERVAL),
        until: Option.isNone,
        times: PORT_RELEASE_ATTEMPTS,
      }),
    );

  const stopUnlocked = (target: ManagedProcessTarget) =>
    Effect.gen(function* () {
      const key = processKey(target);
      const current = (yield* SubscriptionRef.get(state)).processes.get(key);
      if (!current || !isLive(current)) return;
      // The terminal layer drops its descendant pids when the terminal closes,
      // so read them first. They are the only pids escalation may signal.
      const descendants = new Set(yield* discovery.terminalProcessIds(current.terminal));
      yield* markStopped(key, null);
      yield* terminals
        .close({ ...current.terminal })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("managed process terminal close failed", { ...target, cause }),
          ),
        );

      // Closing the shell hangs up its foreground group, which stops an
      // ordinary dev server. Confirm the port is free before trusting that.
      const holder = yield* waitForPortRelease(current.port);
      if (Option.isSome(holder)) {
        const pid = holder.value.pid;
        if (pid !== null && descendants.has(pid)) {
          yield* Effect.logWarning("managed process outlived its terminal; killing it", {
            ...target,
            pid,
            port: current.port,
          });
          yield* inspector.signal(pid, "SIGKILL");
          yield* waitForPortRelease(current.port);
        } else {
          yield* Effect.logWarning("managed process port still held after stop", {
            ...target,
            port: current.port,
            pid,
          });
        }
      }
      yield* forgetListener(target);
      yield* syncDiscoveryPorts;
    });

  const stop: ManagedProcesses["Service"]["stop"] = (target) =>
    lifecycleLock.withPermits(1)(stopUnlocked(target));

  const stopAllForCheckout: ManagedProcesses["Service"]["stopAllForCheckout"] = (
    checkoutPath,
    stopOptions,
  ) =>
    lifecycleLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state);
        yield* Effect.forEach(
          [...current.processes.values()].filter(
            (managed) => managed.checkoutPath === checkoutPath && isLive(managed),
          ),
          (managed) => stopUnlocked(managed),
          { discard: true },
        );
        if (stopOptions?.releaseReservation === true) {
          yield* updateRegistry((registry) => {
            const current = reservationsOf(registry);
            const next = releaseReservation(current, checkoutPath);
            return [
              undefined,
              next === current ? registry : withReservations(registry, next),
            ] as const;
          });
        }
      }),
    );

  const setPinned: ManagedProcesses["Service"]["setPinned"] = (input) =>
    Effect.gen(function* () {
      const target = { checkoutPath: input.checkoutPath, scriptId: input.scriptId };
      const key = processKey(target);
      yield* updateRegistry((registry) => {
        const others = registry.pins.filter((pin) => processKey(pin) !== key);
        return [
          undefined,
          { ...registry, pins: input.pinned ? [...others, target] : others },
        ] as const;
      });
      yield* SubscriptionRef.update(state, (current) => {
        const pins = new Set(current.pins);
        if (input.pinned) pins.add(key);
        else pins.delete(key);
        return { ...current, pins };
      });
    });

  const borrow: ManagedProcesses["Service"]["borrow"] = (target) => {
    const key = processKey(target);
    return Effect.acquireRelease(
      updateProcess(key, (managed) => ({ ...managed, borrowers: managed.borrowers + 1 })),
      () =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            updateProcess(key, (managed) => ({
              ...managed,
              borrowers: Math.max(0, managed.borrowers - 1),
              lastDemandAtMs: now,
            })),
          ),
        ),
    ).pipe(Effect.asVoid);
  };

  const stream: ManagedProcesses["Service"]["stream"] = (checkoutPath) =>
    Stream.unwrap(
      readDetectedDevScript(checkoutPath, platform).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.map((detectedScript) =>
          SubscriptionRef.changes(state).pipe(
            Stream.map((current) => ({ ...snapshotFor(current, checkoutPath), detectedScript })),
          ),
        ),
      ),
    ).pipe(
      Stream.changesWith((left, right) => Equal.equals(left, right)),
      // A slow client only ever holds the newest snapshot.
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
    );

  /** Checkout path to the newest agent activity there, and whether work is live. */
  const readCheckoutActivity = projections.getShellSnapshot().pipe(
    Effect.map((snapshot) => {
      const rootByProject = new Map(
        snapshot.projects.map((project) => [project.id, project.workspaceRoot] as const),
      );
      const activity = new Map<string, { live: boolean; lastActivityMs: number }>();
      for (const thread of snapshot.threads) {
        const checkoutPath = thread.worktreePath ?? rootByProject.get(thread.projectId);
        if (checkoutPath === undefined) continue;
        const previous = activity.get(checkoutPath) ?? { live: false, lastActivityMs: 0 };
        // Turn times, not the session record: the session changes when T3
        // closes an idle session too, which is not the agent working.
        const turn = thread.latestTurn;
        const turnAtMs = turn
          ? Math.max(
              ...[turn.requestedAt, turn.startedAt, turn.completedAt].map((at) =>
                at === null ? 0 : Date.parse(at) || 0,
              ),
            )
          : 0;
        activity.set(checkoutPath, {
          live:
            previous.live ||
            thread.session?.activeTurnId != null ||
            thread.backgroundLiveness != null,
          lastActivityMs: Math.max(previous.lastActivityMs, turnAtMs),
        });
      }
      return activity;
    }),
  );

  const sweep: ManagedProcesses["Service"]["sweep"] = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* SubscriptionRef.get(state);
    let activity: Map<string, { live: boolean; lastActivityMs: number }> | undefined;
    let reapedCount = 0;

    for (const [key, managed] of current.processes) {
      if (!isLive(managed)) continue;
      const target = { checkoutPath: managed.checkoutPath, scriptId: managed.scriptId };
      if (current.pins.has(key)) {
        yield* Effect.logDebug("managed-process.reaper.skipped-pinned", target);
        continue;
      }
      if (managed.borrowers > 0) {
        yield* updateProcess(key, (latest) => ({ ...latest, lastDemandAtMs: now }));
        continue;
      }
      // Plain presence, never shouldRunScopeWork: that one also says no on
      // battery or when the window loses focus, which must not stop a server.
      if (
        yield* backgroundPolicy.hasDemand({
          type: "managed-process",
          checkoutPath: managed.checkoutPath,
        })
      ) {
        yield* updateProcess(key, (latest) => ({ ...latest, lastDemandAtMs: now }));
        continue;
      }
      if (now - managed.lastDemandAtMs < idleThresholdMs) continue;

      activity ??= yield* readCheckoutActivity;
      const checkout = activity.get(managed.checkoutPath);
      if (checkout?.live) {
        yield* Effect.logDebug("managed-process.reaper.skipped-live-thread", target);
        continue;
      }
      const idleDurationMs = now - Math.max(managed.lastDemandAtMs, checkout?.lastActivityMs ?? 0);
      if (idleDurationMs < idleThresholdMs) continue;

      const reaped = yield* stop(target).pipe(
        Effect.tap(() =>
          Effect.logInfo("managed-process.reaped", {
            ...target,
            idleDurationMs,
            reason: "inactivity_threshold",
          }),
        ),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning("managed-process.reaper.stop-failed", { ...target, cause }).pipe(
            Effect.as(false),
          ),
        ),
      );
      if (reaped) reapedCount += 1;
    }

    if (reapedCount > 0) {
      yield* Effect.logInfo("managed-process.reaper.sweep-complete", { reapedCount });
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("managed-process.reaper.sweep-failed", { cause }),
    ),
  );

  // A server killed without running its finalizers leaves its managed
  // processes behind. Stop one only when its pid is alive, its command line is
  // unchanged, and it still holds the recorded port: pids get recycled, and a
  // stranger must never be signalled.
  const reapOrphans = Effect.gen(function* () {
    const recorded = (yield* readRegistry).processes;
    const liveServers = new Set<number>();
    for (const serverPid of new Set(recorded.map((entry) => entry.serverPid))) {
      if (serverPid !== SERVER_PID && (yield* inspector.isAlive(serverPid))) {
        liveServers.add(serverPid);
      }
    }
    const orphans = yield* updateRegistry((registry) => {
      const dead = registry.processes.filter((entry) => !liveServers.has(entry.serverPid));
      return [
        dead,
        dead.length === 0
          ? registry
          : {
              ...registry,
              processes: registry.processes.filter((entry) => liveServers.has(entry.serverPid)),
            },
      ] as const;
    });
    yield* Effect.forEach(
      orphans,
      (entry) =>
        Effect.gen(function* () {
          if (!(yield* inspector.isAlive(entry.pid))) return;
          if ((yield* inspector.commandLine(entry.pid)) !== entry.command) return;
          const holder = yield* discovery.listenerOn(entry.port);
          if (Option.isNone(holder) || holder.value.pid !== entry.pid) return;
          yield* Effect.logWarning("stopping a managed process left behind by a previous server", {
            checkoutPath: entry.checkoutPath,
            scriptId: entry.scriptId,
            pid: entry.pid,
            port: entry.port,
          });
          yield* inspector.signal(entry.pid, "SIGTERM");
        }),
      { discard: true },
    );
  });

  yield* reapOrphans;

  // The terminal layer's finalizer kills every PTY on shutdown, so the
  // processes die with this server. A clean exit leaves no orphan records.
  yield* Effect.addFinalizer(() =>
    SubscriptionRef.get(state).pipe(
      Effect.flatMap((current) =>
        Effect.forEach(
          [...current.processes.values()].filter(isLive),
          (managed) => forgetListener(managed),
          { discard: true },
        ),
      ),
    ),
  );

  /** Frees blocks whose checkout no longer exists on disk. Disk bookkeeping, run hourly. */
  const reconcileRegistry = Effect.gen(function* () {
    const registry = yield* readRegistry;
    const missing = new Set<string>();
    for (const checkoutPath of Object.keys(registry.reservations)) {
      if (!(yield* fs.exists(checkoutPath).pipe(Effect.orElseSucceed(() => true)))) {
        missing.add(checkoutPath);
      }
    }
    if (missing.size === 0) return;
    yield* updateRegistry((latest) => {
      const current = reservationsOf(latest);
      const next = reconcileReservations(current, (checkoutPath) => !missing.has(checkoutPath));
      return [undefined, next === current ? latest : withReservations(latest, next)] as const;
    });
    yield* Effect.logInfo("managed-process.reservations.reconciled", { freed: missing.size });
  });

  return {
    service: ManagedProcesses.of({
      start,
      stop,
      stopAllForCheckout,
      setPinned,
      borrow,
      stream,
      sweep,
    }),
    reconcileRegistry,
  };
});

export const REGISTRY_FILE_NAME = "managed-processes.json";

/**
 * Lives beside the worktrees directory rather than under the per-mode state
 * directory: reservations key on checkout paths, and worktrees are shared by
 * the dev and userdata servers, so both must allocate from one registry.
 */
export const layer = Layer.effect(
  ManagedProcesses,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const baseEnv = process.env.T3CODE_MANAGED_PORT_BASE;
    const rangeStart = baseEnv === undefined ? Number.NaN : Number.parseInt(baseEnv, 10);
    const { service, reconcileRegistry } = yield* make({
      registryPath: path.join(config.baseDir, REGISTRY_FILE_NAME),
      ...(Number.isInteger(rangeStart) && rangeStart > 0
        ? { portRange: { start: rangeStart } }
        : {}),
    });
    yield* forkParked(
      service.sweep.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(DEFAULT_SWEEP_INTERVAL_MS))),
      ),
    );
    yield* forkParked(
      reconcileRegistry.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("managed-process.reservations.reconcile-failed", { cause }),
        ),
        Effect.repeat(Schedule.spaced(RESERVATION_RECONCILE_INTERVAL)),
      ),
    );
    return service;
  }),
);
