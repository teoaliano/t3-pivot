import { DESKTOP_BACKEND_HOME_IN_USE_EXIT_CODE } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";

import * as ServerRuntimeState from "./serverRuntimeState.ts";

const isServerRuntimeStateError = Schema.is(ServerRuntimeState.ServerRuntimeStateError);

interface CapturedLog {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

describe("serverRuntimeState", () => {
  it.effect("persists and reads the runtime state", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "runtime", "server.json");
      const state: ServerRuntimeState.PersistedServerRuntimeState = {
        version: 1,
        pid: 123,
        host: "127.0.0.1",
        port: 4_971,
        origin: "http://127.0.0.1:4971",
        devUrl: "http://localhost:5733/",
        startedAt: "2026-06-20T00:00:00.000Z",
      };

      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state });
      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.deepEqual(Option.getOrThrow(restored), state);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("records the dev web URL when the server fronts a dev server", () =>
    Effect.gen(function* () {
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: new URL("http://localhost:5733") },
        port: 13_773,
      });

      assert.equal(state.devUrl, "http://localhost:5733/");
      assert.equal(state.origin, "http://127.0.0.1:13773");

      const withoutDev = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
      });
      assert.isFalse("devUrl" in withoutDev);
    }),
  );

  it.effect("marks a service-supervised server so CLIs can tell it from a manual one", () =>
    Effect.gen(function* () {
      const managed = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
        serviceManaged: true,
      });
      const manual = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
      });

      assert.isTrue(managed.serviceManaged);
      // Older readers decode the file without the field, so it is omitted
      // rather than written as false.
      assert.isFalse("serviceManaged" in manual);
    }),
  );

  it.effect("treats a missing runtime state file as absent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(
        path.join(root, "missing.json"),
      );

      assert.isTrue(Option.isNone(restored));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves malformed state decode failures", () => {
    const logs: CapturedLog[] = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push({
        message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    });

    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "server.json");
      yield* fileSystem.writeFileString(statePath, "{not json");

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.isTrue(Option.isNone(restored));
      assert.equal(logs[0]?.message, `Failed to decode server runtime state at ${statePath}.`);
      const error = logs[0]?.annotations.cause;
      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "decode");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to decode server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "SchemaError" });
      }
    }).pipe(
      Effect.provide(
        Layer.merge(NodeServices.layer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("preserves runtime state read failures", () => {
    const logs: CapturedLog[] = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push({
        message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    });

    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "server.json");
      yield* fileSystem.makeDirectory(statePath);

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.isTrue(Option.isNone(restored));
      assert.equal(logs[0]?.message, `Failed to read server runtime state at ${statePath}.`);
      const error = logs[0]?.annotations.cause;
      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "read");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to read server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "PlatformError" });
      }
    }).pipe(
      Effect.provide(
        Layer.merge(NodeServices.layer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("preserves runtime state persistence failures", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const blockedDirectory = path.join(root, "not-a-directory");
      const statePath = path.join(blockedDirectory, "server.json");
      yield* fileSystem.writeFileString(blockedDirectory, "blocked");

      const error = yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        state: {
          version: 1,
          pid: 123,
          port: 4_971,
          origin: "http://127.0.0.1:4971",
          startedAt: "2026-06-20T00:00:00.000Z",
        },
      }).pipe(Effect.flip);

      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "persist");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to persist server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "PlatformError" });
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  describe("ensureHomeNotInUse", () => {
    const statePath = "/home/alice/.t3/userdata/server-runtime.json";
    const recorded: ServerRuntimeState.PersistedServerRuntimeState = {
      version: 1,
      pid: 4_242,
      host: "127.0.0.1",
      port: 3_773,
      origin: "http://127.0.0.1:3773",
      startedAt: "2026-09-29T00:00:00.000Z",
    };
    const recordedFile = Schema.encodeSync(
      Schema.fromJsonString(ServerRuntimeState.PersistedServerRuntimeState),
    )(recorded);
    const withStateFile = (contents: string | undefined) =>
      FileSystem.layerNoop({
        readFileString: (path) =>
          contents !== undefined && path === statePath
            ? Effect.succeed(contents)
            : Effect.fail(
                PlatformError.systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              ),
      });
    const guard = (input: {
      readonly contents: string | undefined;
      readonly alivePids: ReadonlyArray<number>;
      readonly answeringOrigins: ReadonlyArray<string>;
      readonly currentPid?: number;
    }) =>
      ServerRuntimeState.ensureHomeNotInUse({
        path: statePath,
        currentPid: input.currentPid ?? 1_000,
        isAlive: (pid) => input.alivePids.includes(pid),
        originAnswers: (origin) => Effect.succeed(input.answeringOrigins.includes(origin)),
      }).pipe(Effect.provide(withStateFile(input.contents)));

    it.effect("continues when no server has recorded itself", () =>
      guard({ contents: undefined, alivePids: [], answeringOrigins: [] }),
    );

    it.effect("continues past a runtime file left by a server that crashed", () =>
      guard({
        contents: recordedFile,
        alivePids: [],
        answeringOrigins: [recorded.origin],
      }),
    );

    it.effect("continues when the recorded pid was reused by a process that is not a server", () =>
      guard({
        contents: recordedFile,
        alivePids: [recorded.pid],
        answeringOrigins: [],
      }),
    );

    it.effect("refuses to start while a live server answers on its recorded origin", () =>
      Effect.gen(function* () {
        const error = yield* guard({
          contents: recordedFile,
          alivePids: [recorded.pid],
          answeringOrigins: [recorded.origin],
        }).pipe(Effect.flip);

        assert.instanceOf(error, ServerRuntimeState.ServerHomeInUseError);
        assert.equal(error.pid, 4_242);
        assert.equal(error.origin, "http://127.0.0.1:3773");
        assert.equal(
          error.message,
          "Another T3 Code server is already using this data (pid 4242, origin http://127.0.0.1:3773).",
        );
        // The desktop recognises this exit code and stops restarting the backend.
        assert.equal(Runtime.getErrorExitCode(error), DESKTOP_BACKEND_HOME_IN_USE_EXIT_CODE);
      }),
    );

    it.effect("continues when the runtime file names the current process", () =>
      guard({
        contents: recordedFile,
        alivePids: [recorded.pid],
        answeringOrigins: [recorded.origin],
        currentPid: recorded.pid,
      }),
    );
  });
});
