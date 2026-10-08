#!/usr/bin/env node

// Maintainer commands for T3 Pivot.
//   sync         open a PR on the fork that merges upstream's newest nightly tag
//   release      build, sign, notarize and publish T3 Pivot from main (release Mac)
//   host-update  keep a server host's checkout level with upstream and running it
// All commands act as the fork owner's GitHub account, whatever gh's active
// account is.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { newestNightlyTag } from "@t3tools/shared/nightlyTag";

import {
  FORK_TAG_PREFIX,
  nightlyBaseVersion,
  planForkVersion,
  planUpstreamSync,
} from "./pivot-release-plan.ts";

const FORK_REPOSITORY = "teoaliano/t3-pivot";
const FORK_ACCOUNT = "teoaliano";
const UPSTREAM_REMOTE = "upstream";
const FORK_REMOTE = "origin";
const APPLE_TEAM_ID = "N2X3SV5FDD";
// Created once with `xcrun notarytool store-credentials t3-pivot`.
const NOTARY_KEYCHAIN_PROFILE = "t3-pivot";
// The systemd user unit that runs a server host's build, and the local ref
// marking the commit that unit last started on.
const HOST_SERVICE = "t3-pivot.service";
const HOST_DEPLOYED_REF = "refs/pivot/deployed";

export class PivotCommandError extends Schema.TaggedError<PivotCommandError>()(
  "PivotCommandError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.String,
  },
) {
  override get message(): string {
    const detail = this.stderr.trim();
    return `\`${this.command}\` exited with code ${this.exitCode}${detail ? `:\n${detail}` : "."}`;
  }
}

export class PivotRefusedError extends Schema.TaggedError<PivotRefusedError>()(
  "PivotRefusedError",
  {
    action: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Refusing to ${this.action}: ${this.reason}`;
  }
}

/** Run a command and return its trimmed stdout, failing on a non-zero exit. */
const run = Effect.fn("pivot.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, { env, extendEnv: true, stdin: "ignore" }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      if (exitCode !== 0) {
        return yield* new PivotCommandError({
          command: [command, ...args].join(" "),
          exitCode,
          stderr,
        });
      }
      return stdout.trim();
    }),
  );
});

/** Run a long command with its output streamed to the terminal. */
const runVisible = Effect.fn("pivot.runVisible")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(command, args, {
      env,
      extendEnv: true,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  if (exitCode !== 0) {
    return yield* new PivotCommandError({
      command: [command, ...args].join(" "),
      exitCode,
      stderr: "",
    });
  }
});

const lines = (output: string) => output.split("\n").filter((line) => line.length > 0);

/** Tag names from `git ls-remote --tags --refs` output. */
const lsRemoteTagNames = (output: string) =>
  lines(output).map((line) => line.replace(/^.*\trefs\/tags\//u, ""));

// gh and gh's git credential helper both honor GH_TOKEN.
const forkAccountEnv = run("gh", ["auth", "token", "--user", FORK_ACCOUNT]).pipe(
  Effect.map((token) => ({ GH_TOKEN: token })),
);

/** Fetches upstream's tags and plans the nightly tag `ref` should merge next. */
const nextUpstreamTag = Effect.fn("pivot.nextUpstreamTag")(function* (ref: string) {
  yield* run("git", ["fetch", "--quiet", "--tags", UPSTREAM_REMOTE]);
  const upstreamTags = lsRemoteTagNames(
    yield* run("git", ["ls-remote", "--tags", "--refs", UPSTREAM_REMOTE]),
  );
  const mergedTags = lines(yield* run("git", ["tag", "--merged", ref, "--list", "v*"]));
  const next = planUpstreamSync({ upstreamTags, mergedTags });
  if (Option.isNone(next)) {
    const level = Option.getOrElse(newestNightlyTag(upstreamTags), () => "upstream");
    yield* Console.log(`already level with ${level}`);
  }
  return next;
});

/** Opens the PR merging `tag` into the fork's main, or prints the one already open. */
const openSyncPr = Effect.fn("pivot.openSyncPr")(function* (
  tag: string,
  env: Record<string, string>,
) {
  const branch = `sync/${tag}`;
  const openPr = yield* run(
    "gh",
    [
      ...["pr", "list", "--repo", FORK_REPOSITORY, "--head", branch, "--state", "open"],
      ...["--json", "url", "--jq", ".[0].url // empty"],
    ],
    env,
  );
  if (openPr.length > 0) {
    yield* Console.log(openPr);
    return;
  }

  yield* run("git", ["push", "--quiet", FORK_REMOTE, `+${tag}^{commit}:refs/heads/${branch}`], env);
  const prUrl = yield* run(
    "gh",
    [
      ...["pr", "create", "--repo", FORK_REPOSITORY, "--base", "main", "--head", branch],
      ...["--title", `chore: merge upstream ${tag}`],
      ...[
        "--body",
        [
          `Merges upstream's nightly build ${tag} into T3 Pivot, so it matches the T3 Code (Nightly) app.`,
          "",
          "Resolve any conflicts on this branch, review upstream's changes, then merge.",
        ].join("\n"),
      ],
    ],
    env,
  );
  yield* Console.log(prUrl);
});

const sync = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  yield* run("git", ["fetch", "--quiet", FORK_REMOTE, "main"], env);
  const next = yield* nextUpstreamTag(`${FORK_REMOTE}/main`);
  if (Option.isSome(next)) yield* openSyncPr(next.value, env);
});

const release = Effect.gen(function* () {
  const env = yield* forkAccountEnv;

  const branch = yield* run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    return yield* new PivotRefusedError({ action: "release", reason: `on ${branch}, not main.` });
  }
  const changes = yield* run("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (changes.length > 0) {
    return yield* new PivotRefusedError({
      action: "release",
      reason: "main has uncommitted changes.",
    });
  }
  yield* run("git", ["fetch", "--quiet", FORK_REMOTE, "main"], env);
  const head = yield* run("git", ["rev-parse", "HEAD"]);
  if (head !== (yield* run("git", ["rev-parse", `${FORK_REMOTE}/main`]))) {
    return yield* new PivotRefusedError({
      action: "release",
      reason: `main differs from ${FORK_REMOTE}/main.`,
    });
  }

  yield* run("git", ["fetch", "--quiet", "--tags", UPSTREAM_REMOTE]);
  const upstreamBaseTag = newestNightlyTag(
    lines(yield* run("git", ["tag", "--merged", "HEAD", "--list", "v*"])),
  );
  if (Option.isNone(upstreamBaseTag)) {
    return yield* new PivotRefusedError({
      action: "release",
      reason: "main contains no upstream nightly tag.",
    });
  }
  const forkTags = lsRemoteTagNames(
    yield* run("git", ["ls-remote", "--tags", "--refs", FORK_REMOTE, `${FORK_TAG_PREFIX}*`], env),
  );
  const version = yield* planForkVersion({
    upstreamBase: Option.getOrThrow(nightlyBaseVersion(upstreamBaseTag.value)),
    forkTags,
  });
  const tag = `${FORK_TAG_PREFIX}${version}`;

  const identity = lines(yield* run("security", ["find-identity", "-v", "-p", "codesigning"]))
    .map((line) => /"Developer ID Application: (.+)"/u.exec(line)?.[1])
    .find((name) => name?.endsWith(`(${APPLE_TEAM_ID})`));
  if (identity === undefined) {
    return yield* new PivotRefusedError({
      action: "release",
      reason: `no Developer ID Application identity for team ${APPLE_TEAM_ID} in the keychain.`,
    });
  }
  // Fail before a long build if the notary profile is missing.
  yield* run("xcrun", ["notarytool", "history", "--keychain-profile", NOTARY_KEYCHAIN_PROFILE]);

  yield* Console.log(`Building T3 Pivot ${version} on upstream ${upstreamBaseTag.value}...`);
  const outputDir = `release/pivot-${version}`;
  yield* runVisible(
    "node",
    [
      "scripts/build-desktop-artifact.ts",
      ...["--platform", "mac", "--target", "dmg", "--arch", "arm64", "--signed"],
      ...["--build-version", version, "--output-dir", outputDir],
    ],
    {
      T3CODE_DESKTOP_UPDATE_REPOSITORY: FORK_REPOSITORY,
      // The app warns when upstream publishes a newer nightly than this one.
      T3CODE_UPSTREAM_BASE_TAG: upstreamBaseTag.value,
      T3CODE_MACOS_SIGNING_MODE: "developer-id",
      CSC_NAME: identity,
      APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE,
    },
  );

  const assets = [
    `T3-Pivot-${version}-arm64.dmg`,
    `T3-Pivot-${version}-arm64.dmg.blockmap`,
    `T3-Pivot-${version}-arm64.zip`,
    `T3-Pivot-${version}-arm64.zip.blockmap`,
    "latest-mac.yml",
  ].map((name) => `${outputDir}/${name}`);
  yield* run("ls", assets);

  // Verify the app exactly as the updater will install it, from the zip.
  const verifyDir = `${outputDir}/verify`;
  yield* run("rm", ["-rf", verifyDir]);
  yield* run("ditto", ["-x", "-k", `${outputDir}/T3-Pivot-${version}-arm64.zip`, verifyDir]);
  const app = `${verifyDir}/T3 Pivot.app`;
  yield* run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  yield* run("xcrun", ["stapler", "validate", app]);
  yield* run("spctl", ["--assess", "--type", "execute", "--verbose", app]);

  const releaseUrl = yield* run(
    "gh",
    [
      ...["release", "create", tag, "--repo", FORK_REPOSITORY, "--target", head],
      ...["--title", `T3 Pivot ${version}`, "--latest", "--generate-notes"],
      ...["--notes", `Built on upstream ${upstreamBaseTag.value}.`],
      ...assets,
    ],
    env,
  );
  yield* Console.log(releaseUrl);
});

export class PivotBuildFailedError extends Schema.TaggedError<PivotBuildFailedError>()(
  "PivotBuildFailedError",
  {
    commit: Schema.String,
  },
) {
  override get message(): string {
    return `T3 Pivot ${this.commit} failed to build. ${HOST_SERVICE} keeps running its deployed build.`;
  }
}

/** Whether a command succeeds, for steps whose failure picks a fallback. */
const succeeds = <E, R>(effect: Effect.Effect<unknown, E | PivotCommandError, R>) =>
  effect.pipe(
    Effect.as(true),
    Effect.catchTags({ PivotCommandError: () => Effect.succeed(false) }),
  );

/** Builds the `t3` server bundle, web client included, into apps/server/dist. */
const buildServer = Effect.gen(function* () {
  yield* runVisible("pnpm", ["install", "--frozen-lockfile"]);
  yield* runVisible("node_modules/.bin/vp", ["run", "--filter", "t3", "build"]);
});

// Runs from the host's dedicated checkout, never a working one. An upstream tag
// that merges cleanly and builds is pushed to main; one that conflicts or breaks
// the build becomes a sync PR instead, and the host keeps its deployed build.
const hostUpdate = Effect.gen(function* () {
  const env = yield* forkAccountEnv;

  const branch = yield* run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    return yield* new PivotRefusedError({ action: "update", reason: `on ${branch}, not main.` });
  }
  const changes = yield* run("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (changes.length > 0) {
    return yield* new PivotRefusedError({
      action: "update",
      reason: "main has uncommitted changes.",
    });
  }
  yield* run("git", ["fetch", "--quiet", FORK_REMOTE, "main"], env);
  yield* run("git", ["merge", "--ff-only", "--quiet", `${FORK_REMOTE}/main`]);

  let mergedTag: string | undefined;
  const next = yield* nextUpstreamTag("HEAD");
  if (Option.isSome(next)) {
    const tag = next.value;
    const merged = yield* succeeds(
      run("git", ["merge", "--no-ff", "--no-verify", "-m", `chore: merge upstream ${tag}`, tag]),
    );
    if (merged) {
      mergedTag = tag;
    } else {
      yield* run("git", ["merge", "--abort"]);
      yield* Console.log(`upstream ${tag} conflicts with main`);
      yield* openSyncPr(tag, env);
    }
  }

  const head = yield* run("git", ["rev-parse", "HEAD"]);
  const deployed = yield* Effect.option(
    run("git", ["rev-parse", "--verify", "--quiet", HOST_DEPLOYED_REF]),
  );
  if (Option.contains(deployed, head)) {
    yield* Console.log(`${HOST_SERVICE} already runs ${head.slice(0, 12)}`);
    return;
  }

  if (!(yield* succeeds(buildServer))) {
    if (mergedTag !== undefined) yield* openSyncPr(mergedTag, env);
    // The failed build replaced dist, which the running server still reads.
    if (Option.isSome(deployed)) {
      yield* run("git", ["reset", "--hard", "--quiet", deployed.value]);
      yield* buildServer;
    }
    return yield* new PivotBuildFailedError({ commit: head.slice(0, 12) });
  }

  if (mergedTag !== undefined) {
    yield* run("git", ["push", "--quiet", FORK_REMOTE, "HEAD:main"], env);
    yield* Console.log(`merged upstream ${mergedTag} into main`);
  }
  // Recorded first: a restart started from inside T3 Pivot ends this process.
  yield* run("git", ["update-ref", HOST_DEPLOYED_REF, head]);
  yield* Console.log(`restarting ${HOST_SERVICE} on ${head.slice(0, 12)}`);
  yield* run("systemctl", ["--user", "restart", HOST_SERVICE]);
});

const pivotCli = Command.make("pivot").pipe(
  Command.withDescription("Keep T3 Pivot level with upstream and publish its releases."),
  Command.withSubcommands([
    Command.make("sync").pipe(
      Command.withDescription("Open a PR merging upstream's newest nightly tag into main."),
      Command.withHandler(() => sync),
    ),
    Command.make("release").pipe(
      Command.withDescription("Build, sign, notarize and publish T3 Pivot from main."),
      Command.withHandler(() => release),
    ),
    Command.make("host-update").pipe(
      Command.withDescription(
        "Merge upstream's newest nightly if it is clean, then rebuild and restart this host's T3 Pivot.",
      ),
      Command.withHandler(() => hostUpdate),
    ),
  ]),
);

if (import.meta.main) {
  Command.run(pivotCli, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
