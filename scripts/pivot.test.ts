import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";

import {
  type ConflictResolver,
  mergeUpstreamTag,
  PivotCommandError,
  PivotConflictError,
  run,
} from "./pivot.ts";

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

/** Writes `content` into `cwd` the way the agent would edit files, then replies. */
const agentWrites =
  (
    content: Record<string, string>,
    reason: string,
    asked: Array<ReadonlyArray<string>> = [],
  ): ConflictResolver =>
  (files, cwd) =>
    Effect.gen(function* () {
      asked.push(files);
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      for (const file of files) {
        yield* fileSystem.writeFileString(path.join(cwd ?? "", file), content[file] ?? "");
      }
      return files.map((file) => ({ file, reason }));
    }).pipe(Effect.provide(NodeServices.layer));

const agentFails: ConflictResolver = () =>
  Effect.fail(new PivotCommandError({ command: "claude -p", exitCode: 1, stderr: "rate limited" }));

const agentMustNotRun: ConflictResolver = () => Effect.die("the agent should not run");

// The checkout after a conflicted merge the agent failed to settle is back where it was.
const assertUntouched = (cwd: string, headBefore: string) =>
  Effect.gen(function* () {
    assert.strictEqual(yield* git(cwd, "rev-parse", "HEAD"), headBefore);
    assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server main\n");
    assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
    assert.isFalse(yield* mergeInProgress(cwd));
  });

describe("mergeUpstreamTag", () => {
  it.effect("merges a nightly that changes different files cleanly", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n" },
        { "shared/server.ts": "server upstream\n" },
      );

      const resolved = yield* mergeUpstreamTag(TAG, cwd, agentMustNotRun);

      assert.deepStrictEqual(resolved, []);
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

      const resolved = yield* mergeUpstreamTag(TAG, cwd, agentMustNotRun);

      assert.deepStrictEqual(resolved, []);
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

  it.effect("sends only the still-conflicted files to the agent and commits its resolution", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const asked: Array<ReadonlyArray<string>> = [];

      const resolved = yield* mergeUpstreamTag(
        TAG,
        cwd,
        agentWrites({ "shared/server.ts": "server merged\n" }, "kept both edits", asked),
      );

      assert.deepStrictEqual(asked, [["shared/server.ts"]]);
      assert.deepStrictEqual(resolved, [{ file: "shared/server.ts", reason: "kept both edits" }]);
      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server merged\n");
      const commit = yield* git(cwd, "log", "-1", "--format=%P%n%B");
      assert.strictEqual(commit.split("\n")[0]?.split(" ").length, 2);
      assert.include(commit, "shared/server.ts: kept both edits");
      assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
      assert.isFalse(yield* mergeInProgress(cwd));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts and fails when the agent fails, leaving the checkout alone", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, cwd, agentFails));

      assert.instanceOf(error, PivotConflictError);
      assert.deepStrictEqual([...error.files].sort(), ["scripts/pivot.ts", "shared/server.ts"]);
      assert.include(error.message, "shared/server.ts");
      assert.include(error.reason, "the agent failed");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts when the agent outlives its time cap", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const started = yield* Deferred.make<void>();
      const stalled: ConflictResolver = () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));

      const outcome = yield* Effect.forkChild(Effect.flip(mergeUpstreamTag(TAG, cwd, stalled)));
      yield* Deferred.await(started);
      yield* TestClock.adjust("10 minutes");
      const error = yield* Fiber.join(outcome);

      assert.instanceOf(error, PivotConflictError);
      assert.include(error.reason, "did not finish");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts without asking the agent when too many files conflict", () =>
    Effect.gen(function* () {
      const files = Array.from({ length: 11 }, (_, index) => `shared/file${index}.ts`);
      const cwd = yield* fixtureCheckout(
        Object.fromEntries(files.map((file) => [file, "main\n"])),
        Object.fromEntries(files.map((file) => [file, "upstream\n"])),
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, cwd, agentMustNotRun));

      assert.instanceOf(error, PivotConflictError);
      assert.include(error.reason, "over its cap of 10");
      assert.strictEqual(yield* git(cwd, "rev-parse", "HEAD"), headBefore);
      assert.strictEqual(yield* git(cwd, "status", "--porcelain"), "");
      assert.isFalse(yield* mergeInProgress(cwd));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts when the agent leaves conflict markers behind", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const markers = "<<<<<<< ours\nserver main\n=======\nserver upstream\n>>>>>>> theirs\n";

      const error = yield* Effect.flip(
        mergeUpstreamTag(TAG, cwd, agentWrites({ "shared/server.ts": markers }, "gave up")),
      );

      assert.instanceOf(error, PivotConflictError);
      assert.include(error.reason, "shared/server.ts still has conflict markers");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts when the agent edits a file it was not given", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
      );
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const stray: ConflictResolver = (files, dir) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* fileSystem.writeFileString(path.join(dir ?? "", "shared/extra.ts"), "extra\n");
          return files.map((file) => ({ file, reason: "resolved" }));
        }).pipe(Effect.provide(NodeServices.layer));

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, cwd, stray));

      assert.instanceOf(error, PivotConflictError);
      assert.include(error.reason, "shared/extra.ts");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
