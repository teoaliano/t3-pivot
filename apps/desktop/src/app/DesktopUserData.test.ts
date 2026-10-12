import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("keeps one T3 Pivot profile per channel", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3pivot-profile-" });
    const resolve = (isDevelopment: boolean) =>
      resolveUserDataPath({ appDataDirectory: directory, isDevelopment, platform: "darwin" });

    assert.equal(yield* resolve(false), path.join(directory, "t3pivot"));
    assert.equal(yield* resolve(true), path.join(directory, "t3pivot-dev"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("never copies T3 Code's Windows credential keys", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3pivot-profile-" });
    for (const name of ["t3code", "t3code-v2", "T3 Code (Alpha)"]) {
      yield* fs.makeDirectory(path.join(directory, name), { recursive: true });
      yield* fs.writeFileString(path.join(directory, name, "Local State"), "T3 Code's keys");
    }

    const userData = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: false,
      platform: "win32",
    });

    assert.equal(userData, path.join(directory, "t3pivot"));
    assert.isFalse(yield* fs.exists(path.join(userData, "Local State")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
