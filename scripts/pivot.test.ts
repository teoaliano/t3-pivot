import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { mergeUpstreamTag, PivotConflictError, run } from "./pivot.ts";

const TAG = "v0.0.46-nightly.20261013.3053";

// The checkout before either side changed. Pivot's file, upstream's file and a
// vendored `.repos/` file are the three kinds of path the merge rules distinguish.
const BASE: Record<string, string> = {
  "scripts/pivot.ts": "pivot base\n",
  "shared/server.ts": "server base\n",
  ".repos/vendor/lib.ts": "vendor base\n",
};

const git = (cwd: string, ...args: ReadonlyArray<string>) => run("git", args, {}, cwd);

/**
 * A checkout on `main` with `main`'s edits, next to upstream's nightly tag, which
 * carries `upstream`'s edits. Both sides start from BASE. The directory is removed
 * with the enclosing scope.
 */
const fixtureCheckout = Effect.fn("pivotTest.fixtureCheckout")(function* (
  main: Record<string, string>,
  upstream: Record<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "pivot-host-update-" });

  const commitFiles = Effect.fn("pivotTest.commitFiles")(function* (
    files: Record<string, string>,
    message: string,
  ) {
    for (const [file, content] of Object.entries(files)) {
      yield* fileSystem.makeDirectory(path.dirname(path.join(cwd, file)), { recursive: true });
      yield* fileSystem.writeFileString(path.join(cwd, file), content);
    }
    yield* git(cwd, "add", "-A");
    yield* git(cwd, "commit", "-q", "-m", message);
  });

  yield* git(cwd, "init", "-q", "-b", "main");
  yield* git(cwd, "config", "user.name", "T3 Pivot tests");
  yield* git(cwd, "config", "user.email", "pivot-tests@example.invalid");
  yield* commitFiles(BASE, "base");
  yield* git(cwd, "checkout", "-q", "-b", "upstream");
  yield* commitFiles(upstream, "upstream");
  yield* git(cwd, "tag", TAG);
  yield* git(cwd, "checkout", "-q", "main");
  yield* commitFiles(main, "main");
  return cwd;
});

const mergeInProgress = (cwd: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* (yield* FileSystem.FileSystem).exists(path.join(cwd, ".git", "MERGE_HEAD"));
  });

const read = (cwd: string, file: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* (yield* FileSystem.FileSystem).readFileString(path.join(cwd, file));
  });

describe("mergeUpstreamTag", () => {
  it.effect("merges a nightly that changes different files cleanly", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n" },
        { "shared/server.ts": "server upstream\n" },
      );

      yield* mergeUpstreamTag(TAG, cwd);

      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server upstream\n");
      assert.strictEqual(
        (yield* git(cwd, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ").length,
        3,
      );
      assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
      assert.isFalse(yield* mergeInProgress(cwd));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("settles conflicts in Pivot-owned and vendored files by owner", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", ".repos/vendor/lib.ts": "vendor main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", ".repos/vendor/lib.ts": "vendor upstream\n" },
      );

      yield* mergeUpstreamTag(TAG, cwd);

      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, ".repos/vendor/lib.ts"), "vendor upstream\n");
      assert.strictEqual(
        (yield* git(cwd, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ").length,
        3,
      );
      assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
      assert.isFalse(yield* mergeInProgress(cwd));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts and fails naming the files no owner settles, leaving the checkout alone", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, cwd));

      assert.instanceOf(error, PivotConflictError);
      assert.deepStrictEqual([...error.files].sort(), ["scripts/pivot.ts", "shared/server.ts"]);
      assert.include(error.message, "shared/server.ts");
      assert.strictEqual(yield* git(cwd, "rev-parse", "HEAD"), headBefore);
      assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server main\n");
      assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
      assert.isFalse(yield* mergeInProgress(cwd));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
