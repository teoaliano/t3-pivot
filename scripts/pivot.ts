#!/usr/bin/env node

// Maintainer commands for T3 Pivot, run by hand on the release Mac.
//   sync     open a PR on the fork that merges upstream's newest stable tag
// Both commands act as the fork owner's GitHub account, whatever gh's active
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
import { Command } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { newestStableTag, planUpstreamSync } from "./pivot-release-plan.ts";

const FORK_REPOSITORY = "teoaliano/t3-pivot";
const FORK_ACCOUNT = "teoaliano";
const UPSTREAM_REMOTE = "upstream";
const FORK_REMOTE = "origin";

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

const lines = (output: string) => output.split("\n").filter((line) => line.length > 0);

// gh and gh's git credential helper both honor GH_TOKEN.
const forkAccountEnv = run("gh", ["auth", "token", "--user", FORK_ACCOUNT]).pipe(
  Effect.map((token) => ({ GH_TOKEN: token })),
);

const sync = Effect.gen(function* () {
  const env = yield* forkAccountEnv;
  yield* run("git", ["fetch", "--quiet", FORK_REMOTE, "main"], env);
  yield* run("git", ["fetch", "--quiet", "--tags", UPSTREAM_REMOTE]);
  const upstreamTags = lines(
    yield* run("git", ["ls-remote", "--tags", "--refs", UPSTREAM_REMOTE]),
  ).map((line) => line.replace(/^.*\trefs\/tags\//u, ""));
  const mergedTags = lines(
    yield* run("git", ["tag", "--merged", `${FORK_REMOTE}/main`, "--list", "v*"]),
  );

  const next = planUpstreamSync({ upstreamTags, mergedTags });
  if (Option.isNone(next)) {
    const level = Option.getOrElse(newestStableTag(upstreamTags), () => "upstream");
    yield* Console.log(`already level with ${level}`);
    return;
  }

  const tag = next.value;
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
          `Merges upstream's stable release ${tag} into T3 Pivot.`,
          "",
          "Resolve any conflicts on this branch, review upstream's changes, then merge.",
        ].join("\n"),
      ],
    ],
    env,
  );
  yield* Console.log(prUrl);
});

const pivotCli = Command.make("pivot").pipe(
  Command.withDescription("Keep T3 Pivot level with upstream and publish its releases."),
  Command.withSubcommands([
    Command.make("sync").pipe(
      Command.withDescription("Open a PR merging upstream's newest stable tag into main."),
      Command.withHandler(() => sync),
    ),
  ]),
);

if (import.meta.main) {
  Command.run(pivotCli, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
