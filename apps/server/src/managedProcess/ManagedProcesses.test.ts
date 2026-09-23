import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type BackgroundScope,
  type DiscoveredLocalServer,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  type TerminalEvent,
  type TerminalSessionSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PortDiscovery, type PortListener } from "../preview/PortScanner.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import * as ManagedProcesses from "./ManagedProcesses.ts";
import { ProcessInspector } from "./ProcessInspector.ts";

/**
 * One simulated machine: which ports are held and by whom, which answer with
 * a web page, which pids are alive, what threads are doing, and what clients
 * are looking at. The fakes below read and write it.
 */
class World {
  readonly listeners = new Map<number, PortListener>();
  readonly webPorts = new Set<number>();
  readonly alive = new Set<number>();
  readonly commandLines = new Map<number, string>();
  readonly signals: Array<{ pid: number; signal: string }> = [];
  readonly descendants = new Map<string, ReadonlyArray<number>>();
  readonly opened: Array<{ threadId: string; terminalId: string; env: Record<string, string> }> =
    [];
  readonly written: Array<{ terminalId: string; data: string }> = [];
  readonly claimedCheckouts = new Set<string>();
  threads: Array<OrchestrationThreadShell> = [];
  projects: Array<{ id: ProjectId; workspaceRoot: string }> = [];
  terminalListeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
  /** What a terminal close does to the ports it held. */
  closeReleasesPort = true;
  private nextPid = 5000;

  /**
   * Simulates a process binding a port. Given a terminal, it is that shell's
   * descendant, as the terminal layer would report it.
   */
  serveFromTerminal(
    port: number,
    terminal?: { readonly threadId: string; readonly terminalId: string },
  ): number {
    const pid = this.nextPid++;
    this.listeners.set(port, { pid, processName: "node" });
    this.alive.add(pid);
    this.commandLines.set(pid, `node vite --port ${port}`);
    if (terminal) this.descendants.set(`${terminal.threadId}/${terminal.terminalId}`, [pid]);
    return pid;
  }

  emit(event: TerminalEvent) {
    return Effect.forEach([...this.terminalListeners], (listener) => listener(event), {
      discard: true,
    });
  }

  killPid(pid: number) {
    this.alive.delete(pid);
    for (const [port, listener] of this.listeners) {
      if (listener.pid === pid) this.listeners.delete(port);
    }
  }
}

const sessionSnapshot = (threadId: string, terminalId: string): TerminalSessionSnapshot => ({
  threadId,
  terminalId,
  cwd: "/work",
  worktreePath: null,
  status: "running",
  pid: 42,
  history: "",
  exitCode: null,
  exitSignal: null,
  label: terminalId,
  updatedAt: "2026-09-23T00:00:00.000Z",
});

const fakeLayer = (world: World) =>
  Layer.mergeAll(
    Layer.mock(TerminalManager)({
      open: (input) =>
        Effect.sync(() => {
          world.opened.push({
            threadId: input.threadId,
            terminalId: input.terminalId,
            env: { ...input.env },
          });
          return sessionSnapshot(input.threadId, input.terminalId);
        }),
      write: (input) =>
        Effect.sync(() => {
          world.written.push({ terminalId: input.terminalId, data: input.data });
        }),
      close: (input) =>
        Effect.gen(function* () {
          const pids = world.descendants.get(`${input.threadId}/${input.terminalId}`) ?? [];
          if (world.closeReleasesPort) for (const pid of pids) world.killPid(pid);
          yield* world.emit({
            type: "closed",
            threadId: input.threadId,
            terminalId: input.terminalId ?? "",
          });
        }),
      subscribe: (listener) =>
        Effect.sync(() => {
          world.terminalListeners.add(listener);
          return () => world.terminalListeners.delete(listener);
        }),
    }),
    Layer.mock(PortDiscovery)({
      scan: () =>
        Effect.sync(() =>
          [...world.webPorts].map((port): DiscoveredLocalServer => ({
            host: "localhost",
            port,
            url: `http://localhost:${port}`,
            processName: world.listeners.get(port)?.processName ?? null,
            pid: world.listeners.get(port)?.pid ?? null,
            terminal: null,
          })),
        ),
      listenerOn: (port) => Effect.sync(() => Option.fromUndefinedOr(world.listeners.get(port))),
      setManagedPorts: () => Effect.void,
      terminalProcessIds: (input) =>
        Effect.sync(() => world.descendants.get(`${input.threadId}/${input.terminalId}`) ?? []),
    }),
    Layer.mock(ProcessInspector)({
      isAlive: (pid) => Effect.sync(() => world.alive.has(pid)),
      commandLine: (pid) => Effect.sync(() => world.commandLines.get(pid) ?? null),
      signal: (pid, signal) =>
        Effect.sync(() => {
          world.signals.push({ pid, signal });
          world.killPid(pid);
        }),
    }),
    Layer.mock(BackgroundPolicy)({
      hasDemand: (scope: BackgroundScope) =>
        Effect.sync(
          () => scope.type === "managed-process" && world.claimedCheckouts.has(scope.checkoutPath),
        ),
      // The host-constrained check says no, as it would on battery. The
      // service must not consult it.
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getShellSnapshot: () =>
        Effect.sync((): OrchestrationShellSnapshot => ({
          snapshotSequence: 1,
          projects: world.projects.map((project) => ({
            id: project.id,
            title: "App",
            workspaceRoot: project.workspaceRoot,
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-09-23T00:00:00.000Z",
            updatedAt: "2026-09-23T00:00:00.000Z",
          })),
          threads: world.threads,
          updatedAt: "2026-09-23T00:00:00.000Z",
        })),
    }),
  );

/** Builds the service inside its own scope, so a test can stop and rebuild it like a restart. */
const boot = (world: World, registryPath: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const built = yield* ManagedProcesses.make({ registryPath }).pipe(
      Effect.provide(fakeLayer(world)),
      Scope.provide(scope),
    );
    return { service: built.service, reconcile: built.reconcileRegistry, scope };
  });

const withRegistry = <A, E>(
  use: (
    registryPath: string,
    fs: FileSystem.FileSystem,
  ) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-managed-processes-" });
    return yield* use(path.join(dir, "managed-processes.json"), fs);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const target = (checkoutPath: string, scriptId = "dev") => ({
  checkoutPath,
  projectRoot: "/work/app",
  worktreePath: checkoutPath === "/work/app" ? null : checkoutPath,
  script: { id: scriptId, name: "Dev server", command: "pnpm dev" },
});

const threadIn = (
  worktreePath: string | null,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  pullRequests: [],
  branch: "feature",
  worktreePath,
  latestTurn: null,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const runningSession = (updatedAt: string, activeTurnId: string | null) => ({
  threadId: ThreadId.make("thread-1"),
  status: "running" as const,
  providerName: "codex",
  runtimeMode: "full-access" as const,
  activeTurnId: activeTurnId === null ? null : TurnId.make(activeTurnId),
  lastError: null,
  updatedAt,
});

/** A settled turn that finished at `HH:MM` after the test clock's epoch. */
const turnCompletedAt = (time: string): OrchestrationThreadShell["latestTurn"] => ({
  turnId: TurnId.make("turn-1"),
  state: "completed",
  requestedAt: "1970-01-01T00:00:00.000Z",
  startedAt: "1970-01-01T00:00:00.000Z",
  completedAt: `1970-01-01T${time}:00.000Z`,
  assistantMessageId: null,
});

const statusOf = (
  service: ManagedProcesses.ManagedProcesses["Service"],
  checkoutPath: string,
  scriptId = "dev",
) =>
  snapshotOf(service, checkoutPath).pipe(
    Effect.map(
      (snapshot) => snapshot.processes.find((process) => process.scriptId === scriptId)?.status,
    ),
  );

/** Waits on the stream, not the clock: readiness also writes the registry file. */
const untilRunning = (
  service: ManagedProcesses.ManagedProcesses["Service"],
  checkoutPath: string,
) =>
  service.stream(checkoutPath).pipe(
    Stream.filter((snapshot) => snapshot.processes[0]?.status === "running"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const idleFor = (minutes: number) => TestClock.adjust(`${minutes} minutes`);

const snapshotOf = (service: ManagedProcesses.ManagedProcesses["Service"], checkoutPath: string) =>
  service.stream(checkoutPath).pipe(Stream.runHead, Effect.map(Option.getOrThrow));

describe("ManagedProcesses", () => {
  it.effect("keeps every checkout's port block across a restart", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const first = yield* boot(world, registryPath);
        const app = yield* first.service.start(target("/work/app"));
        const feature = yield* first.service.start(target("/work/feature"));
        yield* Scope.close(first.scope, Exit.void);

        const second = yield* boot(world, registryPath);
        // Started in the opposite order: blocks come from the file, not from order.
        const featureAgain = yield* second.service.start(target("/work/feature"));
        const appAgain = yield* second.service.start(target("/work/app"));

        expect([app.port, feature.port]).toEqual([11000, 11010]);
        expect([appAgain.port, featureAgain.port]).toEqual([11000, 11010]);
      }),
    ),
  );

  it.effect("starts a script in a terminal with its checkout's reserved port", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        const started = yield* service.start(target("/work/feature"));

        expect(started).toMatchObject({
          checkoutPath: "/work/feature",
          scriptId: "dev",
          status: "starting",
          port: 11000,
          pinned: false,
        });
        expect(world.opened).toHaveLength(1);
        expect(world.opened[0]?.env).toMatchObject({
          PORT: "11000",
          T3CODE_MANAGED_PORT: "11000",
          T3CODE_MANAGED_PORT_9: "11009",
          T3CODE_WORKTREE_PATH: "/work/feature",
        });
        expect(world.written[0]?.data).toContain("pnpm dev");
      }),
    ),
  );

  it.effect("returns the running process instead of starting a second one", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        const first = yield* service.start(target("/work/app"));
        const second = yield* service.start(target("/work/app"));

        expect(second).toEqual(first);
        expect(world.opened).toHaveLength(1);
      }),
    ),
  );

  it.effect("refuses to start on an occupied port and names the occupant", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        world.listeners.set(11000, { pid: 777, processName: "python3" });
        world.commandLines.set(777, "python3 -m http.server 11000");
        const { service } = yield* boot(world, registryPath);
        const error = yield* service.start(target("/work/app")).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "ManagedProcessPortOccupiedError",
          port: 11000,
          occupantPid: 777,
          occupantProcessName: "python3",
          occupantCommand: "python3 -m http.server 11000",
        });
        expect(world.opened).toHaveLength(0);
        // The occupant is never stopped.
        expect(world.signals).toEqual([]);
      }),
    ),
  );

  it.effect("moves the checkout to a new block on request and starts there", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        world.listeners.set(11000, { pid: 777, processName: "python3" });
        const { service } = yield* boot(world, registryPath);
        yield* service.start(target("/work/app")).pipe(Effect.flip);
        const moved = yield* service.start(target("/work/app"), { reallocate: true });
        // The new block is the checkout's from now on.
        yield* service.stop({ checkoutPath: "/work/app", scriptId: "dev" });
        const again = yield* service.start(target("/work/app"));

        expect(moved.port).toBe(11010);
        expect(world.opened[0]?.env.PORT).toBe("11010");
        expect(again.port).toBe(11010);
      }),
    ),
  );

  it.effect("restarts a running process on the new block instead of starting a second one", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        const first = yield* service.start(target("/work/app"));
        world.serveFromTerminal(first.port, first.terminal);

        const moved = yield* service.start(target("/work/app"), { reallocate: true });
        const snapshot = yield* snapshotOf(service, "/work/app");

        expect(moved.port).toBe(11010);
        expect(world.listeners.has(first.port)).toBe(false);
        expect(snapshot.processes).toEqual([expect.objectContaining({ port: 11010 })]);
      }),
    ),
  );

  it.effect("stops a process and confirms its port was released", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        const started = yield* service.start(target("/work/app"));
        world.serveFromTerminal(started.port, started.terminal);

        yield* service.stop({ checkoutPath: "/work/app", scriptId: "dev" });
        const snapshot = yield* snapshotOf(service, "/work/app");

        expect(world.listeners.has(started.port)).toBe(false);
        expect(world.signals).toEqual([]);
        expect(snapshot.processes[0]).toMatchObject({ status: "stopped", lastError: null });
      }),
    ),
  );

  it.effect("kills a descendant that kept the port after its terminal closed", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        world.closeReleasesPort = false;
        const { service } = yield* boot(world, registryPath);
        const started = yield* service.start(target("/work/app"));
        const pid = world.serveFromTerminal(started.port, started.terminal);

        const stopping = yield* service
          .stop({ checkoutPath: "/work/app", scriptId: "dev" })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("10 seconds");
        yield* Fiber.join(stopping);

        expect(world.signals).toEqual([{ pid, signal: "SIGKILL" }]);
        expect(world.listeners.has(started.port)).toBe(false);
      }),
    ),
  );

  it.effect("never signals a port holder the terminal layer did not record", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        world.closeReleasesPort = false;
        const { service } = yield* boot(world, registryPath);
        const started = yield* service.start(target("/work/app"));
        world.serveFromTerminal(started.port);

        const stopping = yield* service
          .stop({ checkoutPath: "/work/app", scriptId: "dev" })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("10 seconds");
        yield* Fiber.join(stopping);

        expect(world.signals).toEqual([]);
      }),
    ),
  );

  it.effect("stops every process of one checkout in one call", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        yield* service.start(target("/work/feature", "dev"));
        yield* service.start(target("/work/feature", "storybook"));
        yield* service.start(target("/work/app", "dev"));

        yield* service.stopAllForCheckout("/work/feature");
        const feature = yield* snapshotOf(service, "/work/feature");
        const app = yield* snapshotOf(service, "/work/app");

        expect(feature.processes.map((process) => process.status)).toEqual(["stopped", "stopped"]);
        expect(app.processes.map((process) => process.status)).toEqual(["starting"]);
      }),
    ),
  );

  it.effect("frees a removed checkout's block when asked to", () =>
    withRegistry((registryPath) =>
      Effect.gen(function* () {
        const world = new World();
        const { service } = yield* boot(world, registryPath);
        yield* service.start(target("/work/gone"));
        yield* service.stopAllForCheckout("/work/gone", { releaseReservation: true });
        const next = yield* service.start(target("/work/new"));

        expect(next.port).toBe(11000);
      }),
    ),
  );

  const writeOrphanRecord = (
    fs: FileSystem.FileSystem,
    registryPath: string,
    entry: { pid: number; port: number; command: string; serverPid: number },
  ) =>
    fs.writeFileString(
      registryPath,
      JSON.stringify({
        version: 1,
        reservations: { "/work/app": 11000 },
        pins: [],
        processes: [{ checkoutPath: "/work/app", scriptId: "dev", ...entry }],
      }),
    );

  it.effect("stops a process left running by a server that was killed", () =>
    withRegistry((registryPath, fs) =>
      Effect.gen(function* () {
        const world = new World();
        const orphan = world.serveFromTerminal(11000);
        yield* writeOrphanRecord(fs, registryPath, {
          pid: orphan,
          port: 11000,
          command: world.commandLines.get(orphan)!,
          // Not in `world.alive`: the server that recorded it is gone.
          serverPid: 1234,
        });

        const { service } = yield* boot(world, registryPath);
        const restarted = yield* service.start(target("/work/app"));

        expect(world.signals).toEqual([{ pid: orphan, signal: "SIGTERM" }]);
        expect(restarted.port).toBe(11000);
      }),
    ),
  );

  it.effect("leaves a recycled pid alone when its command line no longer matches", () =>
    withRegistry((registryPath, fs) =>
      Effect.gen(function* () {
        const world = new World();
        const stranger = world.serveFromTerminal(11000);
        world.commandLines.set(stranger, "/usr/bin/postgres -D /var/lib/postgres");
        yield* writeOrphanRecord(fs, registryPath, {
          pid: stranger,
          port: 11000,
          command: "node vite --port 11000",
          serverPid: 1234,
        });

        yield* boot(world, registryPath);

        expect(world.signals).toEqual([]);
      }),
    ),
  );

  it.effect("leaves the processes of another live server sharing the registry alone", () =>
    withRegistry((registryPath, fs) =>
      Effect.gen(function* () {
        const world = new World();
        const running = world.serveFromTerminal(11000);
        world.alive.add(1234);
        yield* writeOrphanRecord(fs, registryPath, {
          pid: running,
          port: 11000,
          command: world.commandLines.get(running)!,
          serverPid: 1234,
        });

        yield* boot(world, registryPath);

        expect(world.signals).toEqual([]);
      }),
    ),
  );

  describe("reaping", () => {
    it.effect("keeps a borrowed process and reaps it once the last borrow is released", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));
          const borrowScope = yield* Scope.make();
          yield* service
            .borrow({ checkoutPath: "/work/app", scriptId: "dev" })
            .pipe(Scope.provide(borrowScope));

          yield* idleFor(31);
          yield* service.sweep;
          const whileBorrowed = yield* statusOf(service, "/work/app");

          yield* Scope.close(borrowScope, Exit.void);
          yield* idleFor(31);
          yield* service.sweep;

          expect(whileBorrowed).toBe("starting");
          expect(yield* statusOf(service, "/work/app")).toBe("stopped");
        }),
      ),
    );

    it.effect("does not reap a process whose checkout has a thread mid-turn", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          world.threads = [
            threadIn("/work/feature", {
              session: runningSession("1970-01-01T00:00:00.000Z", "turn-1"),
            }),
          ];
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/feature"));

          yield* idleFor(90);
          yield* service.sweep;

          expect(yield* statusOf(service, "/work/feature")).toBe("starting");
        }),
      ),
    );

    it.effect("gives an agent a full idle window after its turn ends", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/feature"));
          // The turn settled 25 minutes in, and nothing has looked since.
          world.threads = [threadIn("/work/feature", { latestTurn: turnCompletedAt("00:25") })];

          yield* idleFor(40);
          yield* service.sweep;
          const beforeWindow = yield* statusOf(service, "/work/feature");
          yield* idleFor(20);
          yield* service.sweep;

          expect(beforeWindow).toBe("starting");
          expect(yield* statusOf(service, "/work/feature")).toBe("stopped");
        }),
      ),
    );

    it.effect("does not count the agent's session being closed for idleness as activity", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/feature"));
          // The last turn ended a minute in. The session reaper closed the idle
          // session 30 minutes later, which touches the session record.
          world.threads = [
            threadIn("/work/feature", {
              latestTurn: turnCompletedAt("00:01"),
              session: runningSession("1970-01-01T00:31:00.000Z", null),
            }),
          ];

          yield* idleFor(35);
          yield* service.sweep;

          expect(yield* statusOf(service, "/work/feature")).toBe("stopped");
        }),
      ),
    );

    it.effect("counts a local thread for its project's main checkout", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          world.projects = [{ id: ProjectId.make("project-1"), workspaceRoot: "/work/app" }];
          world.threads = [
            threadIn(null, { session: runningSession("1970-01-01T00:00:00.000Z", "turn-1") }),
          ];
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));

          yield* idleFor(90);
          yield* service.sweep;

          expect(yield* statusOf(service, "/work/app")).toBe("starting");
        }),
      ),
    );

    it.effect("does not reap a process whose checkout has live background work", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          world.threads = [threadIn("/work/feature", { backgroundLiveness: "monitoring" })];
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/feature"));

          yield* idleFor(90);
          yield* service.sweep;

          expect(yield* statusOf(service, "/work/feature")).toBe("starting");
        }),
      ),
    );

    it.effect("keeps a process a client is looking at, on battery too, until the claim ends", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          world.claimedCheckouts.add("/work/app");
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));

          yield* idleFor(60);
          yield* service.sweep;
          const whileClaimed = yield* statusOf(service, "/work/app");

          // The client's lease expired. The idle window starts from the last
          // sweep that saw the claim.
          world.claimedCheckouts.delete("/work/app");
          yield* idleFor(20);
          yield* service.sweep;
          const soonAfter = yield* statusOf(service, "/work/app");
          yield* idleFor(15);
          yield* service.sweep;

          expect(whileClaimed).toBe("starting");
          expect(soonAfter).toBe("starting");
          expect(yield* statusOf(service, "/work/app")).toBe("stopped");
        }),
      ),
    );

    it.effect("never reaps a pinned process, and shows the pin", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));
          yield* service.setPinned({ checkoutPath: "/work/app", scriptId: "dev", pinned: true });

          yield* idleFor(24 * 60);
          yield* service.sweep;
          const snapshot = yield* snapshotOf(service, "/work/app");

          expect(snapshot.processes[0]).toMatchObject({ status: "starting", pinned: true });
        }),
      ),
    );

    it.effect("keeps a pin across a restart", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const first = yield* boot(world, registryPath);
          yield* first.service.setPinned({
            checkoutPath: "/work/app",
            scriptId: "dev",
            pinned: true,
          });
          yield* Scope.close(first.scope, Exit.void);

          const second = yield* boot(world, registryPath);
          const started = yield* second.service.start(target("/work/app"));

          expect(started.pinned).toBe(true);
        }),
      ),
    );

    it.effect("reaps a process nobody has wanted for thirty minutes", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));

          yield* idleFor(29);
          yield* service.sweep;
          const before = yield* statusOf(service, "/work/app");
          yield* idleFor(2);
          yield* service.sweep;

          expect(before).toBe("starting");
          expect(yield* statusOf(service, "/work/app")).toBe("stopped");
        }),
      ),
    );

    it.effect("never restarts a reaped process", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));
          yield* idleFor(31);
          yield* service.sweep;

          yield* idleFor(6 * 60);
          yield* service.sweep;

          expect(yield* statusOf(service, "/work/app")).toBe("stopped");
          expect(world.opened).toHaveLength(1);
        }),
      ),
    );

    it.effect("leaves a pinned process that exited on its own stopped, with the reason", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          const started = yield* service.start(target("/work/app"));
          yield* service.setPinned({ checkoutPath: "/work/app", scriptId: "dev", pinned: true });

          yield* world.emit({
            type: "exited",
            threadId: started.terminal.threadId,
            terminalId: started.terminal.terminalId,
            exitCode: 1,
            exitSignal: null,
          });
          yield* idleFor(60);
          yield* service.sweep;
          const snapshot = yield* snapshotOf(service, "/work/app");

          expect(snapshot.processes[0]).toMatchObject({
            status: "stopped",
            pinned: true,
            lastError: "Exited with code 1",
          });
          expect(world.opened).toHaveLength(1);
        }),
      ),
    );
  });

  describe("stream", () => {
    it.effect("keeps a stopped process in the stream so it can be started again", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          yield* service.start(target("/work/app"));
          yield* service.stop({ checkoutPath: "/work/app", scriptId: "dev" });

          const snapshot = yield* snapshotOf(service, "/work/app");

          expect(snapshot).toEqual({
            checkoutPath: "/work/app",
            detectedScript: null,
            processes: [
              expect.objectContaining({
                scriptId: "dev",
                scriptName: "Dev server",
                status: "stopped",
                port: 11000,
              }),
            ],
          });
        }),
      ),
    );

    it.effect("offers the checkout's package.json dev script to start", () =>
      withRegistry((registryPath, fs) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          const checkout = yield* fs.makeTempDirectoryScoped({ prefix: "t3-checkout-" });
          yield* fs.writeFileString(`${checkout}/package.json`, '{"scripts":{"dev":"next dev"}}');
          yield* fs.writeFileString(`${checkout}/pnpm-lock.yaml`, "");

          const snapshot = yield* snapshotOf(service, checkout);

          expect(snapshot.detectedScript).toEqual({
            id: "package-json:dev",
            name: "Dev server",
            command: "pnpm run dev --port $PORT",
          });
        }),
      ),
    );

    it.effect("reports starting until the port serves a page, then running", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          const started = yield* service.start(target("/work/app"));
          // Bound, but still compiling: the scanner has not seen HTML yet.
          world.serveFromTerminal(started.port, started.terminal);
          yield* TestClock.adjust("10 seconds");
          const compiling = yield* statusOf(service, "/work/app");

          world.webPorts.add(started.port);
          yield* TestClock.adjust("3 seconds");
          const ready = yield* untilRunning(service, "/work/app");

          expect(compiling).toBe("starting");
          expect(ready.processes[0]?.status).toBe("running");
        }),
      ),
    );

    it.effect("streams changes to a watcher and gives a new subscriber the current state", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const { service } = yield* boot(world, registryPath);
          const watcher = yield* untilRunning(service, "/work/app").pipe(Effect.forkChild);
          const started = yield* service.start(target("/work/app"));
          world.serveFromTerminal(started.port, started.terminal);
          world.webPorts.add(started.port);
          yield* TestClock.adjust("3 seconds");

          const watched = yield* Fiber.join(watcher);
          const reconnected = yield* snapshotOf(service, "/work/app");

          expect(watched.processes[0]?.status).toBe("running");
          expect(reconnected.processes[0]?.status).toBe("running");
        }),
      ),
    );

    it.effect("records the listener once ready, so a restart can find it as an orphan", () =>
      withRegistry((registryPath) =>
        Effect.gen(function* () {
          const world = new World();
          const first = yield* boot(world, registryPath);
          const started = yield* first.service.start(target("/work/app"));
          const listener = world.serveFromTerminal(started.port, started.terminal);
          world.webPorts.add(started.port);
          yield* TestClock.adjust("3 seconds");
          yield* untilRunning(first.service, "/work/app");

          // A killed server runs no finalizers; the next one boots against the same file.
          const writtenByDeadServer = yield* FileSystem.FileSystem.pipe(
            Effect.flatMap((fs) => fs.readFileString(registryPath)),
          );
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(
            registryPath,
            writtenByDeadServer.replace(`"serverPid":${process.pid}`, `"serverPid":1234`),
          );
          yield* boot(world, registryPath);

          expect(world.signals).toEqual([{ pid: listener, signal: "SIGTERM" }]);
        }),
      ),
    );

    it.effect("never calls a stranger that took the port during boot ours", () =>
      withRegistry((registryPath, fs) =>
        Effect.gen(function* () {
          const world = new World();
          const first = yield* boot(world, registryPath);
          const started = yield* first.service.start(target("/work/app"));
          // Something outside our terminal binds the port and serves a page.
          const stranger = world.serveFromTerminal(started.port);
          world.webPorts.add(started.port);
          yield* TestClock.adjust("30 seconds");
          const status = yield* statusOf(first.service, "/work/app");

          const registry = yield* fs.readFileString(registryPath);
          yield* fs.writeFileString(
            registryPath,
            registry.replace(`"serverPid":${process.pid}`, `"serverPid":1234`),
          );
          yield* boot(world, registryPath);

          expect(status).toBe("starting");
          expect(world.signals).not.toContainEqual({ pid: stranger, signal: "SIGTERM" });
        }),
      ),
    );
  });
});
