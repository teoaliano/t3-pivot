import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as NodePath from "@effect/platform-node/NodePath";
import { DESKTOP_BACKEND_DATABASE_NEWER_EXIT_CODE } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Sink from "effect/Sink";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopBrowserHost from "../preview/DesktopBrowserHost.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopWslEnvironment from "../wsl/DesktopWslEnvironment.ts";
import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import type { DesktopBackendStartConfig } from "./DesktopBackendManager.ts";

const primaryConfig: DesktopBackendStartConfig = {
  executablePath: "/electron",
  args: ["/server/bin.mjs", "--bootstrap-fd", "3"],
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: {},
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3774,
    t3Home: "/Users/alice/.t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "fd3",
  extendEnv: true,
  httpBaseUrl: new URL("http://127.0.0.1:3774"),
  captureOutput: false,
  preflightFailure: Option.none(),
};

function makeElectronAppLayer(quit: Effect.Effect<void>) {
  return Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("T3 Pivot"),
    systemLocale: Effect.succeed("en-US"),
    whenReady: Effect.void,
    quit,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: () => Effect.void,
    setAboutPanelOptions: () => Effect.void,
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    requestSingleInstanceLock: Effect.succeed(true),
    setDockIcon: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);
}

const environmentLayer = DesktopEnvironment.layer({
  dirname: "/Applications/T3 Pivot.app/Contents/Resources/app.asar/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.4200",
  appPath: "/Applications/T3 Pivot.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/T3 Pivot.app/Contents/Resources",
  runningUnderArm64Translation: false,
}).pipe(
  Layer.provide(Layer.mergeAll(NodePath.layerPosix, DesktopConfig.layerTest({}))),
  Layer.orDie,
);

interface PoolLayerOverrides {
  readonly fileSystem?: Layer.Layer<FileSystem.FileSystem>;
  readonly spawner?: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>;
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>;
  readonly resolvePrimary?: DesktopBackendConfiguration.DesktopBackendConfiguration["Service"]["resolvePrimary"];
  readonly dialog?: Layer.Layer<ElectronDialog.ElectronDialog>;
  readonly quit?: Effect.Effect<void>;
}

function layerPool(
  labelRef: Ref.Ref<string>,
  overrides: PoolLayerOverrides = {},
): Layer.Layer<DesktopBackendPool.DesktopBackendPool> {
  return DesktopBackendPool.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        overrides.fileSystem ?? FileSystem.layerNoop({}),
        overrides.spawner ??
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() => Effect.die("unexpected child process spawn")),
          ),
        overrides.httpClient ??
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("unexpected HTTP request")),
          ),
        Layer.succeed(DesktopObservability.DesktopBackendOutputLogFactory, {
          forInstance: () =>
            Effect.succeed({
              beginSession: () => Effect.void,
              writeOutputChunk: () => Effect.void,
              persistFailureSnapshot: () => Effect.void,
              persistFailure: () => Effect.void,
              discardSession: Effect.void,
            } satisfies DesktopObservability.DesktopBackendOutputLogShape),
        } satisfies DesktopObservability.DesktopBackendOutputLogFactory["Service"]),
        Layer.succeed(DesktopTelemetryPublisher.DesktopTelemetryPublisher, {
          latest: Effect.succeedNone,
          changes: Stream.empty,
          encoded: Stream.empty,
          handleControlForSource: () => Effect.void,
          removeControlSource: () => Effect.void,
          publishUpdateReport: () => Effect.void,
          updateRequests: Stream.empty,
          updateCommits: Stream.empty,
          updateCancellations: Stream.empty,
        }),
        DesktopBrowserHost.layer,
        Layer.succeed(DesktopBackendConfiguration.DesktopBackendConfiguration, {
          resolvePrimary:
            overrides.resolvePrimary ?? Effect.die("unexpected primary config resolve"),
          resolvePrimaryLabel: Ref.get(labelRef),
          resolveWsl: () => Effect.die("unexpected WSL config resolve"),
          currentBootstrapToken: Effect.die("unexpected bootstrap token read"),
        } satisfies DesktopBackendConfiguration.DesktopBackendConfiguration["Service"]),
        DesktopAppSettings.layerTest(),
        DesktopState.layer,
        DesktopWslEnvironment.layerTest(),
        overrides.dialog ?? ElectronDialog.layer,
        makeElectronAppLayer(overrides.quit ?? Effect.void),
        environmentLayer,
        Layer.succeed(DesktopWindow.DesktopWindow, {
          createMain: Effect.die("unexpected window create"),
          ensureMain: Effect.die("unexpected window ensure"),
          revealOrCreateMain: Effect.die("unexpected window reveal"),
          activate: Effect.die("unexpected window activate"),
          createMainIfBackendReady: Effect.die("unexpected window create"),
          showConnectingSplash: Effect.void,
          handleBackendReady: () => Effect.void,
          handleBackendNotReady: Effect.void,
          flushMainWindowBounds: Effect.void,
          prepareCaptureReveal: Effect.void,
          dispatchMenuAction: () => Effect.die("unexpected menu action"),
          dispatchSnapShotEvent: () => Effect.void,
          zoomMain: () => Effect.die("unexpected zoom"),
          runMainContentsCommand: () => Effect.die("unexpected main contents command"),
          syncAppearance: Effect.void,
        } satisfies DesktopWindow.DesktopWindow["Service"]),
      ),
    ),
  );
}

describe("DesktopBackendPool", () => {
  it.effect("tells the user to update and quits when a newer build migrated the database", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const labelRef = yield* Ref.make("Local");
        const shown = yield* Deferred.make<{ readonly title: string; readonly content: string }>();
        const quit = yield* Deferred.make<void>();

        const poolLayer = layerPool(labelRef, {
          fileSystem: FileSystem.layerNoop({ exists: () => Effect.succeed(true) }),
          spawner: Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make(() =>
              Effect.succeed(
                ChildProcessSpawner.makeHandle({
                  pid: ChildProcessSpawner.ProcessId(123),
                  stdout: Stream.empty,
                  stderr: Stream.empty,
                  all: Stream.empty,
                  exitCode: Effect.succeed(
                    ChildProcessSpawner.ExitCode(DESKTOP_BACKEND_DATABASE_NEWER_EXIT_CODE),
                  ),
                  isRunning: Effect.succeed(false),
                  kill: () => Effect.void,
                  stdin: Sink.drain,
                  getInputFd: () => Sink.drain,
                  getOutputFd: () => Stream.empty,
                  unref: Effect.succeed(Effect.void),
                }),
              ),
            ),
          ),
          httpClient: Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.never),
          ),
          resolvePrimary: Effect.succeed(primaryConfig),
          dialog: Layer.succeed(ElectronDialog.ElectronDialog, {
            pickFolder: () => Effect.die("unexpected folder picker"),
            pickFiles: () => Effect.die("unexpected file picker"),
            showMessageBox: () => Effect.die("unexpected message box"),
            showErrorBox: (title, content) =>
              Deferred.succeed(shown, { title, content }).pipe(Effect.asVoid),
          }),
          quit: Deferred.succeed(quit, undefined).pipe(Effect.asVoid),
        });

        yield* Effect.gen(function* () {
          const pool = yield* DesktopBackendPool.DesktopBackendPool;
          const primary = yield* pool.primary;

          yield* primary.start;

          assert.deepEqual(yield* Deferred.await(shown), {
            title: "T3 Pivot can't start",
            content: "A newer version already upgraded this data. Update T3 Pivot, then reopen it.",
          });
          yield* Deferred.await(quit);
        }).pipe(Effect.provide(poolLayer));
      }),
    ),
  );

  it.effect("unregister stops the registered instance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const id = DesktopBackendPool.BackendInstanceId("wsl:Ubuntu");
        const pool = yield* DesktopBackendPool.DesktopBackendPool;
        const instance = yield* pool.register({
          id,
          label: Effect.succeed("WSL (Ubuntu)"),
          configResolve: Effect.succeed({
            executablePath: "/electron",
            args: [],
            entryPath: "/server/bin.mjs",
            cwd: "/server",
            env: {},
            bootstrap: {
              mode: "desktop",
              noBrowser: true,
              port: 3774,
              t3Home: "/tmp/t3",
              host: "127.0.0.1",
              desktopBootstrapToken: "token",
              tailscaleServeEnabled: false,
              tailscaleServePort: 443,
            },
            bootstrapDelivery: "fd3",
            extendEnv: true,
            httpBaseUrl: new URL("http://127.0.0.1:3774"),
            captureOutput: false,
            preflightFailure: Option.some({ reason: "WSL starting", fatal: false }),
          } satisfies DesktopBackendStartConfig),
        });
        yield* instance.start;
        assert.equal((yield* instance.snapshot).restartScheduled, true);

        yield* pool.unregister(id);

        const stopped = yield* instance.snapshot;
        assert.equal(stopped.desiredRunning, false);
        assert.equal(stopped.restartScheduled, false);
        assert.equal(Option.isNone(yield* pool.get(id)), true);
      }).pipe(Effect.provide(layerPool(Ref.makeUnsafe("Windows")))),
    ),
  );
});
