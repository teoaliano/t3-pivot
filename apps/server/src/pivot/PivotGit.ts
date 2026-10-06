/**
 * PivotGit - the git questions Pivot mode asks of a project: is it a repository,
 * does it have a remote, which branch is the default, has a teammate's work
 * landed, and can a ready branch fast-forward onto the default branch.
 *
 * Runs git directly so its answers can be tested against real repositories.
 *
 * @module PivotGit
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

export class PivotGitError extends Schema.TaggedError<PivotGitError>()("PivotGitError", {
  cwd: Schema.String,
  args: Schema.Array(Schema.String),
  stderr: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const detail = this.stderr.trim();
    return `git ${this.args.join(" ")} failed${detail.length > 0 ? `: ${detail}` : "."}`;
  }
}

/** Whether a teammate's work is safe to throw away, and why or why not. */
export type LandedVerdict =
  | { readonly landed: true; readonly reason: string }
  | { readonly landed: false; readonly reason: string };

export class PivotGit extends Context.Service<
  PivotGit,
  {
    readonly isRepository: (cwd: string) => Effect.Effect<boolean>;
    readonly hasRemote: (cwd: string) => Effect.Effect<boolean, PivotGitError>;
    /** The origin's default branch when there is a remote, else the local one. */
    readonly defaultBranch: (cwd: string) => Effect.Effect<string, PivotGitError>;
    readonly branchExists: (cwd: string, branch: string) => Effect.Effect<boolean, PivotGitError>;
  }
>()("t3/pivot/PivotGit") {}

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;

  const run = (cwd: string, args: ReadonlyArray<string>) =>
    runner
      .run({ command: "git", args, cwd })
      .pipe(Effect.mapError((cause) => new PivotGitError({ cwd, args, stderr: "", cause })));
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    run(cwd, args).pipe(
      Effect.flatMap((output) =>
        output.code === 0
          ? Effect.succeed(output.stdout.trim())
          : Effect.fail(new PivotGitError({ cwd, args, stderr: output.stderr })),
      ),
    );
  /** True when git exits 0, false on any other exit. */
  const succeeds = (cwd: string, args: ReadonlyArray<string>) =>
    run(cwd, args).pipe(Effect.map((output) => output.code === 0));

  const hasRemote = (cwd: string) =>
    git(cwd, ["remote"]).pipe(Effect.map((remotes) => remotes.split("\n").includes("origin")));

  const branchExists = (cwd: string, branch: string) =>
    succeeds(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);

  const defaultBranch = Effect.fn("PivotGit.defaultBranch")(function* (cwd: string) {
    if (yield* hasRemote(cwd)) {
      const head = yield* run(cwd, [
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
      ]);
      if (head.code === 0 && head.stdout.trim().startsWith("origin/")) {
        return head.stdout.trim().slice("origin/".length);
      }
    }
    for (const candidate of ["main", "master"]) {
      if (yield* branchExists(cwd, candidate)) return candidate;
    }
    return yield* git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  });

  return PivotGit.of({
    isRepository: (cwd) =>
      succeeds(cwd, ["rev-parse", "--is-inside-work-tree"]).pipe(Effect.orElseSucceed(() => false)),
    hasRemote,
    defaultBranch,
    branchExists,
  });
});

export const layer = Layer.effect(PivotGit, make);
