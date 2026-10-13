import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  launchdPath,
  type MergeAgent,
  type MergeAgentRequest,
  type MergeBuild,
  mergeUpstreamTag,
  PivotCommandError,
  PivotMergeError,
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

const writeFiles = (cwd: string, files: Record<string, string>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, content] of Object.entries(files)) {
      yield* fileSystem.makeDirectory(path.dirname(path.join(cwd, file)), { recursive: true });
      yield* fileSystem.writeFileString(path.join(cwd, file), content);
    }
  }).pipe(Effect.provide(NodeServices.layer));

/** Edits files in the checkout the way the agent would, then replies with `summary`. */
const agentWrites =
  (
    content: Record<string, string>,
    summary: string,
    asked: Array<MergeAgentRequest> = [],
  ): MergeAgent =>
  (request, cwd) => {
    asked.push(request);
    return writeFiles(cwd ?? "", content).pipe(Effect.as(summary));
  };

const agentAsksForDecision =
  (decision: string): MergeAgent =>
  (request) =>
    Effect.gen(function* () {
      yield* (yield* FileSystem.FileSystem).writeFileString(request.decisionPath, decision);
      return "stopped for a decision";
    }).pipe(Effect.provide(NodeServices.layer));

const agentFails: MergeAgent = () =>
  Effect.fail(new PivotCommandError({ command: "claude -p", exitCode: 1, stderr: "rate limited" }));

const agentMustNotRun: MergeAgent = () => Effect.die("the agent should not run");

const builds: MergeBuild = Effect.void;

/** A build that fails while `file` in `cwd` contains `needle`. */
const buildFailsWhile = (cwd: string, file: string, needle: string): MergeBuild =>
  read(cwd, file).pipe(
    Effect.flatMap((content) =>
      content.includes(needle)
        ? Effect.fail(new PivotCommandError({ command: "vp build", exitCode: 1, stderr: "" }))
        : Effect.void,
    ),
    Effect.provide(NodeServices.layer),
  );

const parentCount = (cwd: string) =>
  git(cwd, "rev-list", "--parents", "-n", "1", "HEAD").pipe(
    Effect.map((line) => line.split(" ").length - 1),
  );

// A merge that falls through leaves the checkout exactly where it was.
const assertUntouched = (cwd: string, headBefore: string) =>
  Effect.gen(function* () {
    assert.strictEqual(yield* git(cwd, "rev-parse", "HEAD"), headBefore);
    assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server main\n");
    assert.strictEqual(yield* git(cwd, "status", "--porcelain", "--untracked-files=all"), "");
    assert.isFalse(yield* mergeInProgress(cwd));
  });

const assertCommitted = (cwd: string) =>
  Effect.gen(function* () {
    assert.strictEqual(yield* parentCount(cwd), 2);
    assert.strictEqual(yield* git(cwd, "status", "--porcelain", "--untracked-files=all"), "");
    assert.isFalse(yield* mergeInProgress(cwd));
  });

const conflictingCheckout = fixtureCheckout(
  { "scripts/pivot.ts": "pivot main\n", "shared/server.ts": "server main\n" },
  { "scripts/pivot.ts": "pivot upstream\n", "shared/server.ts": "server upstream\n" },
);

describe("mergeUpstreamTag", () => {
  it.effect("commits a nightly that merges cleanly and builds, without the agent", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n" },
        { "shared/server.ts": "server upstream\n" },
      );

      const summary = yield* mergeUpstreamTag(TAG, { build: builds, agent: agentMustNotRun }, cwd);

      assert.strictEqual(summary, "");
      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server upstream\n");
      yield* assertCommitted(cwd);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("settles conflicts in Pivot-owned and vendored files by owner", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n", ".repos/vendor/lib.ts": "vendor main\n" },
        { "scripts/pivot.ts": "pivot upstream\n", ".repos/vendor/lib.ts": "vendor upstream\n" },
      );

      const summary = yield* mergeUpstreamTag(TAG, { build: builds, agent: agentMustNotRun }, cwd);

      assert.strictEqual(summary, "");
      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, ".repos/vendor/lib.ts"), "vendor upstream\n");
      yield* assertCommitted(cwd);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sends the files the owner rules leave open to the agent and commits its work", () =>
    Effect.gen(function* () {
      const cwd = yield* conflictingCheckout;
      const asked: Array<MergeAgentRequest> = [];
      const agent = agentWrites(
        { "shared/server.ts": "server merged\n" },
        "shared/server.ts | kept both edits",
        asked,
      );

      const summary = yield* mergeUpstreamTag(TAG, { build: builds, agent }, cwd);

      assert.deepStrictEqual(
        asked.map(({ conflicted, buildFailed }) => ({ conflicted, buildFailed })),
        [{ conflicted: ["shared/server.ts"], buildFailed: false }],
      );
      assert.strictEqual(summary, "shared/server.ts | kept both edits");
      assert.strictEqual(yield* read(cwd, "scripts/pivot.ts"), "pivot main\n");
      assert.strictEqual(yield* read(cwd, "shared/server.ts"), "server merged\n");
      assert.include(yield* git(cwd, "log", "-1", "--format=%B"), "kept both edits");
      yield* assertCommitted(cwd);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("has the agent fix a clean merge that doesn't build, new files included", () =>
    Effect.gen(function* () {
      const cwd = yield* fixtureCheckout(
        { "scripts/pivot.ts": "pivot main\n" },
        { "shared/server.ts": "server upstream broken\n" },
      );
      const asked: Array<MergeAgentRequest> = [];
      const agent = agentWrites(
        { "shared/server.ts": "server upstream\n", "shared/adapter.ts": "adapter\n" },
        "ported Pivot to upstream's change",
        asked,
      );
      const build = buildFailsWhile(cwd, "shared/server.ts", "broken");

      yield* mergeUpstreamTag(TAG, { build, agent }, cwd);

      assert.deepStrictEqual(
        asked.map(({ conflicted, buildFailed }) => ({ conflicted, buildFailed })),
        [{ conflicted: [], buildFailed: true }],
      );
      assert.strictEqual(yield* read(cwd, "shared/adapter.ts"), "adapter\n");
      assert.include(
        yield* git(cwd, "show", "--name-only", "--format=", "HEAD"),
        "shared/adapter.ts",
      );
      yield* assertCommitted(cwd);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls through with the agent's explanation when it asks for a decision", () =>
    Effect.gen(function* () {
      const cwd = yield* conflictingCheckout;
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const agent = agentAsksForDecision("Upstream removed the sidebar Pivot extends.");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, { build: builds, agent }, cwd));

      assert.instanceOf(error, PivotMergeError);
      assert.include(error.reason, "needs your decision");
      assert.include(error.reason, "Upstream removed the sidebar Pivot extends.");
      yield* assertUntouched(cwd, headBefore);
      assert.isFalse(
        yield* (yield* FileSystem.FileSystem).exists(
          (yield* Path.Path).join(cwd, ".git", "PIVOT_DECISION.md"),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls through when the agent fails", () =>
    Effect.gen(function* () {
      const cwd = yield* conflictingCheckout;
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");

      const error = yield* Effect.flip(
        mergeUpstreamTag(TAG, { build: builds, agent: agentFails }, cwd),
      );

      assert.instanceOf(error, PivotMergeError);
      assert.include(error.reason, "the agent failed");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls through when the agent leaves conflict markers behind", () =>
    Effect.gen(function* () {
      const cwd = yield* conflictingCheckout;
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const markers = "<<<<<<< ours\nserver main\n=======\nserver upstream\n>>>>>>> theirs\n";
      const agent = agentWrites({ "shared/server.ts": markers }, "gave up");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, { build: builds, agent }, cwd));

      assert.instanceOf(error, PivotMergeError);
      assert.include(error.reason, "shared/server.ts still has conflict markers");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls through, removing the agent's files, when the merge still doesn't build", () =>
    Effect.gen(function* () {
      const cwd = yield* conflictingCheckout;
      const headBefore = yield* git(cwd, "rev-parse", "HEAD");
      const agent = agentWrites(
        { "shared/server.ts": "server broken\n", "shared/scratch.ts": "scratch\n" },
        "tried",
      );
      const build = buildFailsWhile(cwd, "shared/server.ts", "broken");

      const error = yield* Effect.flip(mergeUpstreamTag(TAG, { build, agent }, cwd));

      assert.instanceOf(error, PivotMergeError);
      assert.include(error.reason, "still does not build");
      yield* assertUntouched(cwd, headBefore);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("launchdPath", () => {
  it("replaces fnm's per-shell directories with Node's own directory", () => {
    const node = "/Users/me/.local/share/fnm/node-versions/v24.21.0/installation/bin";
    assert.strictEqual(
      launchdPath(
        [
          "/Users/me/.local/share/vite-plus/bin",
          "/Users/me/.local/state/fnm_multishells/1_2/bin",
          "/opt/homebrew/bin",
          "/Users/me/.local/state/fnm_multishells/3_4/bin",
          "/usr/bin",
        ].join(":"),
        node,
      ),
      ["/Users/me/.local/share/vite-plus/bin", node, "/opt/homebrew/bin", "/usr/bin"].join(":"),
    );
  });

  it("keeps a PATH without fnm's per-shell directories as it is", () => {
    assert.strictEqual(
      launchdPath("/usr/local/bin:/usr/bin:", "/opt/node/bin"),
      "/usr/local/bin:/usr/bin",
    );
  });
});
