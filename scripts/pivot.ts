#!/usr/bin/env node

// Maintainer commands for T3 Pivot.
//   sync         open a PR on the fork that merges upstream's newest nightly tag
//   release      build, sign, notarize and publish T3 Pivot from main (release Mac)
//   ios-release  upload the iPhone app for main's release to TestFlight (release Mac)
//   nightly      publish whatever main has not released yet, desktop and iPhone, and
//                install it on the release Mac
//   nightly-install  schedule `nightly` with launchd, from the release Mac's clone
//   host-update  merge upstream's newest nightly into main, with an agent finishing
//                what the owner rules leave open, then rebuild and restart the host
// All commands act as the fork owner's GitHub account, whatever gh's active
// account is.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { newestNightlyTag } from "@t3tools/shared/nightlyTag";

import {
  FORK_TAG_PREFIX,
  iosBuildNumber,
  nightlyBaseVersion,
  planForkVersion,
  planUpstreamSync,
  releasedVersion,
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
// The iPhone app ships through TestFlight under the same team. Expo's prebuild
// names the Xcode workspace and scheme after the app's display name.
const IOS_BUNDLE_ID = "com.teoaliano.t3pivot";
const IOS_PROJECT = "T3Pivot";
// The local ref marking the commit the release Mac last uploaded to TestFlight.
const IOS_UPLOADED_REF = "refs/pivot/testflight";
const NIGHTLY_LABEL = "com.teoaliano.t3pivot.nightly";
// The machine-owned clone `nightly` and `host-update` run from, relative to $HOME.
const DEDICATED_CLONE = ".t3-pivot/app";
const INSTALLED_APP = "/Applications/T3 Pivot.app";

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
export const run = Effect.fn("pivot.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
  cwd?: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd, env, extendEnv: true, stdin: "ignore" }),
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
  cwd?: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(command, args, {
      cwd,
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

/** Whether a command succeeds, for steps whose failure picks a fallback. */
const succeeds = <E, R>(effect: Effect.Effect<unknown, E | PivotCommandError, R>) =>
  effect.pipe(
    Effect.as(true),
    Effect.catchTags({ PivotCommandError: () => Effect.succeed(false) }),
  );

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

interface SyncPr {
  readonly tag: string;
  readonly url: string;
}

/** The fork's open `sync/<tag>` PRs, each waiting on a decision from the maintainer. */
const openSyncPrs = Effect.fn("pivot.openSyncPrs")(function* (env: Record<string, string>) {
  const output = yield* run(
    "gh",
    [
      ...["pr", "list", "--repo", FORK_REPOSITORY, "--state", "open"],
      ...["--json", "headRefName,url"],
      ...[
        "--jq",
        '.[] | select(.headRefName | startswith("sync/")) | "\\(.headRefName)\\t\\(.url)"',
      ],
    ],
    env,
  );
  return lines(output).map((line): SyncPr => {
    const [branch = "", url = ""] = line.split("\t");
    return { tag: branch.slice("sync/".length), url };
  });
});

/**
 * Opens the PR merging `tag` into the fork's main, or prints the one already open.
 * `reason` says why it could not merge on its own, for the PR body.
 */
const openSyncPr = Effect.fn("pivot.openSyncPr")(function* (
  tag: string,
  env: Record<string, string>,
  reason?: string,
) {
  const open = (yield* openSyncPrs(env)).find((pr) => pr.tag === tag);
  if (open !== undefined) {
    yield* Console.log(open.url);
    return;
  }

  const branch = `sync/${tag}`;
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
          ...(reason === undefined
            ? []
            : ["The nightly update could not merge it on its own:", "", reason, ""]),
          "Resolve any conflicts on this branch, review upstream's changes, then merge.",
        ].join("\n"),
      ],
    ],
    env,
  );
  yield* Console.log(prUrl);
});

/** Closes open sync PRs whose tag HEAD now contains, since a later merge settled them. */
const closeSettledSyncPrs = Effect.fn("pivot.closeSettledSyncPrs")(function* (
  env: Record<string, string>,
) {
  for (const pr of yield* openSyncPrs(env)) {
    const settled = yield* Effect.option(
      run("git", ["merge-base", "--is-ancestor", `${pr.tag}^{commit}`, "HEAD"]),
    );
    if (Option.isNone(settled)) continue;
    yield* run(
      "gh",
      [
        ...["pr", "close", pr.url, "--delete-branch"],
        ...["--comment", "Main now contains this nightly, merged by the nightly update."],
      ],
      env,
    );
    yield* Console.log(`closed ${pr.url}, which main now contains`);
  }
});

/** Refuses unless the checkout is on `main` with no uncommitted changes to tracked files. */
const ensureCleanMain = Effect.fn("pivot.ensureCleanMain")(function* (action: string) {
  const branch = yield* run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    return yield* new PivotRefusedError({ action, reason: `on ${branch}, not main.` });
  }
  const changes = yield* run("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (changes.length > 0) {
    return yield* new PivotRefusedError({ action, reason: "main has uncommitted changes." });
  }
});

/** Refuses unless HEAD is exactly the fork's `main`, so a release never ships local commits. */
const ensureLevelWithOrigin = Effect.fn("pivot.ensureLevelWithOrigin")(function* (
  action: string,
  env: Record<string, string>,
) {
  yield* run("git", ["fetch", "--quiet", "--tags", FORK_REMOTE, "main"], env);
  const head = yield* run("git", ["rev-parse", "HEAD"]);
  if (head !== (yield* run("git", ["rev-parse", `${FORK_REMOTE}/main`]))) {
    return yield* new PivotRefusedError({
      action,
      reason: `main differs from ${FORK_REMOTE}/main.`,
    });
  }
  return head;
});

/**
 * Resets the dedicated clone to origin/main and returns HEAD. The clone is machine-owned,
 * so a change left behind by a build or a crashed run is discarded rather than stopping
 * the morning. Refuses anywhere else, so it never touches a working checkout.
 */
const resetDedicatedClone = Effect.fn("pivot.resetDedicatedClone")(function* (
  action: string,
  env: Record<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clone = path.join(process.env.HOME ?? "", DEDICATED_CLONE);
  const here = yield* fileSystem.realPath(process.cwd());
  const expected = yield* Effect.option(fileSystem.realPath(clone));
  if (!Option.contains(expected, here)) {
    return yield* new PivotRefusedError({
      action,
      reason: `it resets its checkout to ${FORK_REMOTE}/main, so it only runs from the dedicated clone at ~/${DEDICATED_CLONE}.`,
    });
  }

  yield* run("git", ["fetch", "--quiet", "--tags", FORK_REMOTE, "main"], env);
  const changes = yield* run("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (changes.length > 0) yield* Console.log(`discarding local changes:\n${changes}`);
  // Also ends a merge a crashed run left in progress.
  yield* run("git", ["reset", "--hard", "--quiet"]);
  yield* run("git", ["checkout", "--quiet", "--force", "-B", "main", `${FORK_REMOTE}/main`]);
  return yield* run("git", ["rev-parse", "HEAD"]);
});

/** The fork release already tagged on HEAD, from the fork's tags fetched last. */
const headRelease = run("git", [
  "tag",
  "--points-at",
  "HEAD",
  "--list",
  `${FORK_TAG_PREFIX}*`,
]).pipe(Effect.map((output) => releasedVersion(lines(output))));

const sync = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  yield* run("git", ["fetch", "--quiet", FORK_REMOTE, "main"], env);
  const next = yield* nextUpstreamTag(`${FORK_REMOTE}/main`);
  if (Option.isSome(next)) yield* openSyncPr(next.value, env);
});

/** Publishes the desktop release for HEAD and returns its version. */
const release = Effect.gen(function* () {
  const env = yield* forkAccountEnv;

  yield* ensureCleanMain("release");
  const head = yield* ensureLevelWithOrigin("release", env);

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
  // Notarize with the App Store Connect key when there is one. The keychain profile
  // can't be read by the 07:30 launchd run while the Mac is locked; the key file can.
  const notary = Option.match(yield* appStoreConnectKey("release"), {
    onNone: () => ({
      args: ["--keychain-profile", NOTARY_KEYCHAIN_PROFILE],
      env: { APPLE_KEYCHAIN_PROFILE: NOTARY_KEYCHAIN_PROFILE },
    }),
    onSome: ({ keyId, issuerId, keyPath }) => ({
      args: ["--key", keyPath, "--key-id", keyId, "--issuer", issuerId],
      env: { APPLE_API_KEY: keyPath, APPLE_API_KEY_ID: keyId, APPLE_API_ISSUER: issuerId },
    }),
  });
  // Fail before a long build if notarization can't sign in.
  yield* run("xcrun", ["notarytool", "history", ...notary.args]);

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
      ...notary.env,
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
  // Start the bundled backend the way the desktop app does. Signing checks pass
  // for a bundle that cannot load, which is how 0.0.4605 shipped a backend that
  // crashed on an import left unresolved by a stale local install.
  yield* run(
    `${app}/Contents/MacOS/T3 Pivot`,
    [`${app}/Contents/Resources/app.asar/apps/server/dist/bin.mjs`, "--version"],
    { ELECTRON_RUN_AS_NODE: "1" },
  );
  // A leftover copy shows up next to the installed app in Spotlight and Launchpad.
  yield* run("rm", ["-rf", verifyDir]);

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
  return version;
});

interface AppStoreConnectKey {
  readonly keyId: string;
  readonly issuerId: string;
  readonly keyPath: string;
}

// TestFlight uploads and notarization use an App Store Connect API key. Its .p8 sits
// where Apple's tools look for it; its ids come from the environment. None when not
// set up.
const appStoreConnectKey = Effect.fn("pivot.appStoreConnectKey")(function* (action: string) {
  const keyId = process.env.T3PIVOT_ASC_KEY_ID?.trim();
  const issuerId = process.env.T3PIVOT_ASC_ISSUER_ID?.trim();
  if (!keyId || !issuerId) return Option.none<AppStoreConnectKey>();
  const keyPath = `${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;
  if (!(yield* (yield* FileSystem.FileSystem).exists(keyPath))) {
    return yield* new PivotRefusedError({
      action,
      reason: `no App Store Connect key at ${keyPath}.`,
    });
  }
  return Option.some<AppStoreConnectKey>({ keyId, issuerId, keyPath });
});

const EXPORT_OPTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
</dict>
</plist>
`;

/**
 * Builds the iPhone app at HEAD as `version` and uploads it to TestFlight. It is
 * the same reduced-capability T3 Pivot build as a personal-team install (no
 * widgets, push, Sign in with Apple or OTA updates), signed by the fork's team.
 */
const uploadIos = Effect.fn("pivot.uploadIos")(function* (
  version: string,
  key: AppStoreConnectKey,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const build = iosBuildNumber(yield* DateTime.now);
  const outputDir = `release/ios-${version}-${build}`;
  const archivePath = `${outputDir}/${IOS_PROJECT}.xcarchive`;
  const exportOptionsPath = `${outputDir}/ExportOptions.plist`;
  const appEnv = {
    APP_VARIANT: "production",
    EXPO_NO_GIT_STATUS: "1",
    T3CODE_IOS_PERSONAL_TEAM: "1",
    T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: IOS_BUNDLE_ID,
  };
  const authArgs = [
    "-allowProvisioningUpdates",
    ...["-authenticationKeyPath", key.keyPath],
    ...["-authenticationKeyID", key.keyId],
    ...["-authenticationKeyIssuerID", key.issuerId],
  ];

  yield* Console.log(`Uploading the T3 Pivot iPhone app ${version} (${build}) to TestFlight...`);
  yield* runVisible(
    "pnpm",
    ["exec", "expo", "prebuild", "--clean", "--platform", "ios"],
    appEnv,
    "apps/mobile",
  );
  yield* runVisible(
    "xcodebuild",
    [
      "archive",
      ...["-workspace", `apps/mobile/ios/${IOS_PROJECT}.xcworkspace`],
      ...["-scheme", IOS_PROJECT, "-configuration", "Release"],
      ...["-destination", "generic/platform=iOS", "-archivePath", archivePath],
      ...authArgs,
      `DEVELOPMENT_TEAM=${APPLE_TEAM_ID}`,
      "CODE_SIGN_STYLE=Automatic",
      `MARKETING_VERSION=${version}`,
      `CURRENT_PROJECT_VERSION=${build}`,
    ],
    // The archive bundles the JS, which reads the app config again.
    appEnv,
  );
  yield* fileSystem.writeFileString(exportOptionsPath, EXPORT_OPTIONS);
  yield* runVisible("xcodebuild", [
    "-exportArchive",
    ...["-archivePath", archivePath, "-exportOptionsPlist", exportOptionsPath],
    ...["-exportPath", `${outputDir}/export`],
    ...authArgs,
  ]);
  yield* Console.log(`uploaded ${version} (${build}); TestFlight installs it once processed`);
});

/** Records that HEAD's iPhone build reached TestFlight. */
const markIosUploaded = Effect.gen(function* () {
  yield* run("git", ["update-ref", IOS_UPLOADED_REF, yield* run("git", ["rev-parse", "HEAD"])]);
});

const iosRelease = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  yield* ensureCleanMain("upload to TestFlight");
  yield* ensureLevelWithOrigin("upload to TestFlight", env);
  const version = yield* headRelease;
  if (Option.isNone(version)) {
    return yield* new PivotRefusedError({
      action: "upload to TestFlight",
      reason: "main has no desktop release yet. Run `pivot:release` first.",
    });
  }
  const key = yield* appStoreConnectKey("upload to TestFlight");
  if (Option.isNone(key)) {
    return yield* new PivotRefusedError({
      action: "upload to TestFlight",
      reason: "set T3PIVOT_ASC_KEY_ID and T3PIVOT_ASC_ISSUER_ID.",
    });
  }
  yield* runVisible("pnpm", ["install", "--frozen-lockfile"]);
  yield* uploadIos(version.value, key.value);
  yield* markIosUploaded;
});

/** Shows a macOS notification; one that cannot be shown is only logged. */
const notify = (message: string) =>
  Effect.ignore(
    run("osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title "T3 Pivot"`,
    ]),
  );

/**
 * Installs `version`, built in this clone, as the Mac's T3 Pivot. Waits while T3 Pivot is
 * open, since replacing it would end its running turns; its update button offers the
 * same release, and the next run installs it if it is still closed.
 */
const installApp = Effect.fn("pivot.installApp")(function* (version: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const installed = yield* Effect.option(
    run("plutil", [
      ...["-extract", "CFBundleShortVersionString", "raw"],
      `${INSTALLED_APP}/Contents/Info.plist`,
    ]),
  );
  if (Option.contains(installed, version)) return;
  const zip = `release/pivot-${version}/T3-Pivot-${version}-arm64.zip`;
  if (!(yield* fileSystem.exists(zip))) {
    yield* Console.log(`${zip} is not in this clone, so ${version} was not installed.`);
    return;
  }
  if (yield* succeeds(run("pgrep", ["-x", "T3 Pivot"]))) {
    yield* Console.log(`T3 Pivot is open, so ${version} waits for its update button.`);
    return;
  }

  const unpacked = `release/pivot-${version}/install`;
  yield* fileSystem.remove(unpacked, { recursive: true, force: true });
  yield* run("ditto", ["-x", "-k", zip, unpacked]);
  yield* fileSystem.remove(INSTALLED_APP, { recursive: true, force: true });
  yield* run("ditto", [`${unpacked}/T3 Pivot.app`, INSTALLED_APP]);
  yield* fileSystem.remove(unpacked, { recursive: true, force: true });
  yield* Console.log(`installed T3 Pivot ${version}`);
});

// Runs from the release Mac's dedicated clone at login and every morning (see
// `nightly-install`). Merges upstream's newest nightly into main, then publishes
// the desktop release and the TestFlight build that `main` doesn't have yet and
// installs the release here, so running it again is a no-op.
const nightly = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  yield* resetDedicatedClone("publish nightly", env);
  yield* mergeUpstream(env);
  const head = yield* run("git", ["rev-parse", "HEAD"]);

  const waiting = yield* openSyncPrs(env);
  if (waiting.length > 0) {
    yield* Console.log(
      `upstream merges waiting on you:\n${waiting.map((pr) => pr.url).join("\n")}`,
    );
    yield* notify(
      `${waiting.length} upstream merge${waiting.length === 1 ? " needs" : "s need"} your decision on GitHub.`,
    );
  }

  const released = yield* headRelease;
  const key = yield* appStoreConnectKey("upload to TestFlight");
  const uploaded = yield* Effect.option(
    run("git", ["rev-parse", "--verify", "--quiet", IOS_UPLOADED_REF]),
  );
  const iosDue = Option.isSome(key) && !Option.contains(uploaded, head);
  if (Option.isSome(released) && !iosDue) {
    yield* Console.log(`already published ${released.value} at ${head.slice(0, 12)}`);
    yield* installApp(released.value);
    return;
  }

  yield* runVisible("pnpm", ["install", "--frozen-lockfile"]);
  const version = Option.isSome(released) ? released.value : yield* release;
  yield* installApp(version);
  if (Option.isNone(key)) {
    yield* Console.log("TestFlight is not set up, so the iPhone app was not uploaded.");
    return;
  }
  yield* uploadIos(version, key.value);
  yield* markIosUploaded;
});

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * The PATH launchd runs `nightly` with: this shell's PATH, with fnm's per-shell
 * directories, which vanish with the shell, replaced by this Node's own directory.
 */
export const launchdPath = (shellPath: string, nodeDirectory: string) => {
  const ephemeral = (entry: string) => entry.includes("/fnm_multishells/");
  const entries = shellPath
    .split(":")
    .filter((entry) => entry.length > 0)
    .map((entry) => (ephemeral(entry) ? nodeDirectory : entry));
  return [...new Set(entries)].join(":");
};

// Writes a launchd agent that runs `nightly` from this checkout at 07:30 and at
// every login. launchd runs a calendar job missed during sleep on wake; the
// login run covers a Mac that was off. Rerun after changing the TestFlight ids.
const nightlyInstall = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = process.env.HOME ?? "";
  const plistPath = `${home}/Library/LaunchAgents/${NIGHTLY_LABEL}.plist`;
  const logPath = `${home}/Library/Logs/t3-pivot-nightly.log`;
  const environment: Record<string, string | undefined> = {
    PATH: launchdPath(process.env.PATH ?? "", path.dirname(process.execPath)),
    // launchd sets no locale, and CocoaPods fails without a UTF-8 one.
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    T3PIVOT_ASC_KEY_ID: process.env.T3PIVOT_ASC_KEY_ID,
    T3PIVOT_ASC_ISSUER_ID: process.env.T3PIVOT_ASC_ISSUER_ID,
  };
  const command = [
    "node scripts/pivot.ts nightly",
    `osascript -e 'display notification "Nightly release failed. See ${logPath}" with title "T3 Pivot"'`,
  ].join(" || ");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${NIGHTLY_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(process.cwd())}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(environment)
  .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
  .map(([name, value]) => `    <key>${name}</key>\n    <string>${escapeXml(value)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>7</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
  yield* fileSystem.writeFileString(plistPath, plist);
  const domain = `gui/${yield* run("id", ["-u"])}`;
  // Replace a loaded copy; bootout fails harmlessly when none is loaded.
  yield* Effect.ignore(run("launchctl", ["bootout", `${domain}/${NIGHTLY_LABEL}`]));
  yield* run("launchctl", ["bootstrap", domain, plistPath]);
  yield* Console.log(`scheduled ${NIGHTLY_LABEL} from ${process.cwd()}; it also runs now`);
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

/** Builds the `t3` server bundle, web client included, into apps/server/dist. */
const buildServer = Effect.gen(function* () {
  yield* runVisible("pnpm", ["install", "--frozen-lockfile"]);
  yield* runVisible("node_modules/.bin/vp", ["run", "--filter", "t3", "build"]);
});

export class PivotMergeError extends Schema.TaggedError<PivotMergeError>()("PivotMergeError", {
  tag: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `could not merge upstream ${this.tag} into main: ${this.reason}`;
  }
}

// Who settles a conflict first. Pivot-owned files exist only in the fork, so a conflict
// there keeps main's side. `.repos/` is vendored upstream code the fork never edits
// (see AGENTS.md), so a conflict there takes upstream's side. Anything else goes to
// the merge agent below.
const PIVOT_OWNED_PATHS = [
  "scripts/pivot.ts",
  "scripts/pivot-release-plan.ts",
  "scripts/pivot-release-plan.test.ts",
  "docs/operations/pivot-releases.md",
];
const UPSTREAM_OWNED_PATHS = [".repos/"];

const owns = (paths: ReadonlyArray<string>, file: string) =>
  paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));

// The agent that finishes a merge the owner rules leave open or that doesn't build. It
// has every tool and no time limit, because finishing can take real porting work.
const MERGE_AGENT_MODEL = "claude-sonnet-5-5";
const MERGE_AGENT_EFFORT = "high";
// Where the agent explains a change only the maintainer can decide. It lives in .git,
// so the merge never commits it.
const DECISION_FILE = "PIVOT_DECISION.md";
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(?=\s|$)/mu;

export interface MergeAgentRequest {
  readonly tag: string;
  /** Files still in conflict after the owner rules; empty when only the build fails. */
  readonly conflicted: ReadonlyArray<string>;
  readonly buildFailed: boolean;
  /** The absolute path the agent writes to when the merge needs the maintainer. */
  readonly decisionPath: string;
}

/** Finishes the merge in progress in `cwd` and replies with what it changed. */
export type MergeAgent = (
  request: MergeAgentRequest,
  cwd?: string,
) => Effect.Effect<
  string,
  PivotCommandError | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
>;

/** Builds the checked-out tree, failing when it does not build. */
export type MergeBuild = Effect.Effect<
  void,
  PivotCommandError | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
>;

const mergePrompt = ({ tag, conflicted, buildFailed, decisionPath }: MergeAgentRequest) =>
  [
    `This is T3 Pivot, a fork of T3 Code. Upstream's nightly build ${tag} is being merged`,
    "into main, and the merge is in progress, not committed. Finish it.",
    ...(conflicted.length > 0
      ? ["", "These files still have conflicts:", ...conflicted.map((file) => `- ${file}`)]
      : []),
    ...(buildFailed
      ? ["", "The merged tree fails `node_modules/.bin/vp run --filter t3 build`."]
      : []),
    "",
    "Read AGENTS.md first. Keep the intent of both sides: upstream's change, and what T3 Pivot",
    "adds on top of it. Fix whatever the merge breaks, including Pivot code that has to follow",
    "an upstream change. You are done when no conflict marker is left, `pnpm install` and",
    "`node_modules/.bin/vp run --filter t3 build` pass, and the typecheck and tests for the code",
    "you changed pass. The whole working tree becomes the merge commit, so remove any scratch",
    "files you create. Do not commit, push, abort the merge or switch branches.",
    "",
    "Stop only for a decision the maintainer has to make: a breaking change, upstream or in",
    "Pivot, that needs Pivot's design reworked rather than ported. Then write what changed,",
    `why it needs a rework and the options you see to ${decisionPath}, and stop there.`,
    "Never write that file otherwise.",
    "",
    "Reply with what you changed and why, one line per file.",
  ].join("\n");

/**
 * Finishes the merge with Claude Sonnet 5.5 at high effort, run headless from the release
 * Mac's nightly with every tool and no permission prompts. It authenticates with the Mac
 * user's Claude Code login.
 */
export const runMergeAgent: MergeAgent = Effect.fn("pivot.runMergeAgent")(function* (
  request: MergeAgentRequest,
  cwd?: string,
) {
  return yield* run(
    "claude",
    [
      "-p",
      mergePrompt(request),
      ...["--model", MERGE_AGENT_MODEL, "--effort", MERGE_AGENT_EFFORT],
      "--dangerously-skip-permissions",
      "--no-session-persistence",
    ],
    {},
    cwd,
  );
});

/**
 * Merges upstream `tag` into the checked-out branch in `cwd` and commits it once it
 * builds. Conflicts go to their owner first (see PIVOT_OWNED_PATHS and
 * UPSTREAM_OWNED_PATHS). Conflicts left over, or a merge that doesn't build, go to
 * `agent`. Fails with PivotMergeError, the checkout restored to where it was, when the
 * agent asks for the maintainer's decision, fails, or leaves a merge that still
 * doesn't build. Returns the agent's summary, empty when the merge needed no agent.
 */
export const mergeUpstreamTag = Effect.fn("pivot.mergeUpstreamTag")(function* (
  tag: string,
  steps: { readonly build: MergeBuild; readonly agent: MergeAgent },
  cwd?: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = (...args: ReadonlyArray<string>) => run("git", args, {}, cwd);
  const message = `chore: merge upstream ${tag}`;
  const head = yield* git("rev-parse", "HEAD");
  // The agent may have run anything, so restore by commit rather than by aborting.
  const fail = (reason: string) =>
    git("reset", "--hard", "--quiet", head).pipe(
      Effect.andThen(git("clean", "-fdq")),
      Effect.andThen(new PivotMergeError({ tag, reason })),
    );

  return yield* Effect.gen(function* () {
    const merged = yield* Effect.result(git("merge", "--no-ff", "--no-commit", "--no-verify", tag));
    const conflicted = Result.isFailure(merged)
      ? lines(yield* git("diff", "--name-only", "--diff-filter=U"))
      : [];
    if (Result.isFailure(merged) && conflicted.length === 0) return yield* merged.failure;

    const owned = (file: string) =>
      owns(PIVOT_OWNED_PATHS, file) || owns(UPSTREAM_OWNED_PATHS, file);
    for (const file of conflicted.filter(owned)) {
      yield* git("checkout", owns(PIVOT_OWNED_PATHS, file) ? "--ours" : "--theirs", "--", file);
      yield* git("add", "--", file);
    }
    const unowned = conflicted.filter((file) => !owned(file));
    const buildFailed = unowned.length === 0 && !(yield* succeeds(steps.build));

    let summary = "";
    if (unowned.length > 0 || buildFailed) {
      const decisionPath = path.resolve(
        cwd ?? ".",
        yield* git("rev-parse", "--git-path", DECISION_FILE),
      );
      yield* fileSystem.remove(decisionPath, { force: true });
      const reply = yield* Effect.result(
        steps.agent({ tag, conflicted: unowned, buildFailed, decisionPath }, cwd),
      );
      if (yield* fileSystem.exists(decisionPath)) {
        const decision = (yield* fileSystem.readFileString(decisionPath)).trim();
        yield* fileSystem.remove(decisionPath, { force: true });
        return yield* fail(`it needs your decision.\n\n${decision}`);
      }
      if (Result.isFailure(reply)) return yield* fail(`the agent failed: ${reply.failure.message}`);
      if (
        Option.isNone(yield* Effect.option(git("rev-parse", "--verify", "--quiet", "MERGE_HEAD")))
      ) {
        return yield* fail("the agent ended the merge instead of leaving it to be committed.");
      }
      for (const file of unowned) {
        const absolute = path.join(cwd ?? "", file);
        if (!(yield* fileSystem.exists(absolute))) continue;
        if (CONFLICT_MARKER.test(yield* fileSystem.readFileString(absolute))) {
          return yield* fail(`${file} still has conflict markers after the agent.`);
        }
      }
      yield* git("add", "-A");
      if (!(yield* succeeds(steps.build))) {
        return yield* fail("it still does not build after the agent.");
      }
      summary = reply.success.trim();
    }

    yield* git(
      "commit",
      "--no-verify",
      "-m",
      message,
      ...(summary.length > 0 ? ["-m", summary] : []),
    );
    return summary;
  }).pipe(Effect.catchTags({ PivotCommandError: (error) => fail(error.message) }));
});

/**
 * Merges upstream's newest nightly into the dedicated clone's main and pushes it. A merge
 * that needs the maintainer becomes a `sync/<tag>` PR instead, and main stays as it was.
 */
const mergeUpstream = Effect.fn("pivot.mergeUpstream")(function* (env: Record<string, string>) {
  const next = yield* nextUpstreamTag("HEAD");
  if (Option.isNone(next)) return;
  const merged = yield* Effect.result(
    mergeUpstreamTag(next.value, { build: buildServer, agent: runMergeAgent }),
  );
  if (Result.isFailure(merged)) {
    if (merged.failure._tag !== "PivotMergeError") return yield* merged.failure;
    yield* Console.log(merged.failure.message);
    yield* openSyncPr(next.value, env, merged.failure.reason);
    return;
  }
  if (merged.success.length > 0) {
    yield* Console.log(`the agent finished the merge:\n${merged.success}`);
  }
  yield* run("git", ["push", "--quiet", FORK_REMOTE, "HEAD:main"], env);
  yield* Console.log(`merged upstream ${next.value} into main`);
  yield* closeSettledSyncPrs(env);
});

// Runs from the host's dedicated clone (see `t3-pivot-update.timer`). It resets to
// origin/main, which the release Mac's nightly keeps level with upstream, then rebuilds
// and restarts the host when main moved.
const hostUpdate = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  const head = yield* resetDedicatedClone("update", env);
  const deployed = yield* Effect.option(
    run("git", ["rev-parse", "--verify", "--quiet", HOST_DEPLOYED_REF]),
  );
  if (Option.contains(deployed, head)) {
    yield* Console.log(`${HOST_SERVICE} already runs ${head.slice(0, 12)}`);
    return;
  }

  if (!(yield* succeeds(buildServer))) {
    // The failed build replaced dist, which the running server still reads.
    if (Option.isSome(deployed)) {
      yield* run("git", ["reset", "--hard", "--quiet", deployed.value]);
      yield* buildServer;
    }
    return yield* new PivotBuildFailedError({ commit: head.slice(0, 12) });
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
      Command.withHandler(() => Effect.asVoid(release)),
    ),
    Command.make("ios-release").pipe(
      Command.withDescription("Upload the iPhone app for main's desktop release to TestFlight."),
      Command.withHandler(() => iosRelease),
    ),
    Command.make("nightly").pipe(
      Command.withDescription(
        "Merge upstream's newest nightly, then publish the desktop release and TestFlight build main doesn't have yet.",
      ),
      Command.withHandler(() => nightly),
    ),
    Command.make("nightly-install").pipe(
      Command.withDescription("Run `nightly` from this checkout at 07:30 and at every login."),
      Command.withHandler(() => nightlyInstall),
    ),
    Command.make("host-update").pipe(
      Command.withDescription(
        "Fast-forward to main, then rebuild and restart this host's T3 Pivot.",
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
