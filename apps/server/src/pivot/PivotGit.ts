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
  subcommand: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `git ${this.subcommand} failed${this.exitCode === null ? "" : ` with exit code ${this.exitCode}`}.`;
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
    /** Local branch names under `prefix`, e.g. `pivot/`. */
    readonly listBranches: (
      cwd: string,
      prefix: string,
    ) => Effect.Effect<ReadonlyArray<string>, PivotGitError>;
    readonly headCommit: (cwd: string) => Effect.Effect<string, PivotGitError>;
    /** What `origin` has for the branch right now, or null when it has none. */
    readonly remoteBranchCommit: (
      cwd: string,
      branch: string,
    ) => Effect.Effect<string | null, PivotGitError>;
    /** Whether the checkout has no uncommitted or untracked changes. */
    readonly isClean: (cwd: string) => Effect.Effect<boolean, PivotGitError>;
    /**
     * Whether a teammate's work has landed, so its worktree can go: reachable from a
     * remote-tracking ref, or its PR merged with a head containing the local work, or
     * its content already in the up-to-date default branch (local-only: the local one).
     * Uncommitted work never counts; anything git cannot answer does not land.
     */
    readonly landed: (input: {
      readonly projectRoot: string;
      readonly worktreePath: string;
      readonly branch: string;
      readonly defaultBranch: string;
      readonly mergedPullRequestHead: string | null;
    }) => Effect.Effect<LandedVerdict>;
    /**
     * Fast-forwards the default branch to `branch`, in the checkout that has it checked
     * out if any. Refuses a branch that does not contain the default branch's tip.
     */
    readonly fastForward: (input: {
      readonly projectRoot: string;
      readonly branch: string;
      readonly defaultBranch: string;
    }) => Effect.Effect<
      | { readonly landed: true; readonly head: string }
      | { readonly landed: false; readonly reason: string },
      PivotGitError
    >;
  }
>()("t3/pivot/PivotGit") {}

export const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;

  const run = (cwd: string, args: ReadonlyArray<string>) =>
    runner
      .run({ command: "git", args, cwd })
      .pipe(
        Effect.mapError(
          (cause) => new PivotGitError({ subcommand: args[0] ?? "", exitCode: null, cause }),
        ),
      );
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    run(cwd, args).pipe(
      Effect.flatMap((output) =>
        output.code === 0
          ? Effect.succeed(output.stdout.trim())
          : Effect.fail(new PivotGitError({ subcommand: args[0] ?? "", exitCode: output.code })),
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

  const commitOf = (cwd: string, revision: string) =>
    run(cwd, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]).pipe(
      Effect.map((output) => (output.code === 0 ? output.stdout.trim() : null)),
    );

  const isClean = (cwd: string) =>
    git(cwd, ["status", "--porcelain"]).pipe(Effect.map((out) => out.length === 0));

  const landed = Effect.fn("PivotGit.landed")(
    function* (input: {
      readonly projectRoot: string;
      readonly worktreePath: string;
      readonly branch: string;
      readonly defaultBranch: string;
      readonly mergedPullRequestHead: string | null;
    }) {
      const inWorktree = yield* succeeds(input.worktreePath, [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      if (inWorktree && !(yield* isClean(input.worktreePath))) {
        return { landed: false, reason: "Its worktree has uncommitted changes." } as LandedVerdict;
      }
      const cwd = input.projectRoot;
      const local = yield* commitOf(cwd, `refs/heads/${input.branch}`);
      if (local === null) {
        return { landed: false, reason: `Its branch ${input.branch} is gone.` } as LandedVerdict;
      }
      const remote = yield* hasRemote(cwd);
      if (remote) yield* run(cwd, ["fetch", "--quiet", "--prune", "origin"]);

      if (input.mergedPullRequestHead !== null) {
        if (input.mergedPullRequestHead === local) {
          return { landed: true, reason: "Its PR merged at its latest commit." } as LandedVerdict;
        }
        if ((yield* commitOf(cwd, input.mergedPullRequestHead)) === null && remote) {
          yield* run(cwd, ["fetch", "--quiet", "origin", input.mergedPullRequestHead]);
        }
        if (
          yield* succeeds(cwd, ["merge-base", "--is-ancestor", local, input.mergedPullRequestHead])
        ) {
          return {
            landed: true,
            reason: "Its PR merged with a head containing its work.",
          } as LandedVerdict;
        }
      }
      const tracking = yield* git(cwd, [
        "for-each-ref",
        "--format=%(refname:short)",
        "--contains",
        local,
        "refs/remotes",
      ]);
      const containing = tracking
        .split("\n")
        .filter((ref) => ref.length > 0 && !ref.endsWith("/HEAD"));
      if (containing.length > 0) {
        return { landed: true, reason: `Its commits are on ${containing[0]}.` } as LandedVerdict;
      }
      // Content already in the default branch: merging the work into it would change nothing.
      for (const target of remote
        ? [`refs/remotes/origin/${input.defaultBranch}`]
        : [`refs/heads/${input.defaultBranch}`]) {
        const targetCommit = yield* commitOf(cwd, target);
        if (targetCommit === null) continue;
        if (yield* succeeds(cwd, ["merge-base", "--is-ancestor", local, targetCommit])) {
          return {
            landed: true,
            reason: `Its commits are in ${input.defaultBranch}.`,
          } as LandedVerdict;
        }
        const merged = yield* run(cwd, ["merge-tree", "--write-tree", targetCommit, local]);
        const targetTree = yield* git(cwd, ["rev-parse", `${targetCommit}^{tree}`]);
        if (merged.code === 0 && merged.stdout.split("\n")[0]?.trim() === targetTree) {
          return {
            landed: true,
            reason: `Its changes are already in ${input.defaultBranch}.`,
          } as LandedVerdict;
        }
      }
      return {
        landed: false,
        reason: `${input.branch} has work that is on no remote and not in ${input.defaultBranch}.`,
      } as LandedVerdict;
    },
    (effect) =>
      effect.pipe(
        Effect.catch((error: PivotGitError) =>
          Effect.succeed({
            landed: false,
            reason: `Could not tell whether it landed: ${error.message}`,
          } as LandedVerdict),
        ),
      ),
  );

  const fastForward = Effect.fn("PivotGit.fastForward")(function* (input: {
    readonly projectRoot: string;
    readonly branch: string;
    readonly defaultBranch: string;
  }) {
    const cwd = input.projectRoot;
    const head = yield* commitOf(cwd, `refs/heads/${input.branch}`);
    const base = yield* commitOf(cwd, `refs/heads/${input.defaultBranch}`);
    if (head === null) return { landed: false as const, reason: `Branch ${input.branch} is gone.` };
    if (base === null) {
      return {
        landed: false as const,
        reason: `Default branch ${input.defaultBranch} is missing.`,
      };
    }
    if (!(yield* succeeds(cwd, ["merge-base", "--is-ancestor", base, head]))) {
      return {
        landed: false as const,
        reason: `${input.branch} has diverged from ${input.defaultBranch}; the teammate rebases onto it first.`,
      };
    }
    if (head === base) return { landed: true as const, head };
    const worktrees = yield* git(cwd, ["worktree", "list", "--porcelain"]);
    const checkedOut = worktrees
      .split("\n\n")
      .map((block) => block.split("\n"))
      .find((lines) => lines.includes(`branch refs/heads/${input.defaultBranch}`))?.[0]
      ?.replace(/^worktree /, "");
    if (checkedOut !== undefined) {
      const merged = yield* run(checkedOut, ["merge", "--ff-only", "--quiet", head]);
      if (merged.code !== 0) {
        return {
          landed: false as const,
          reason: `Fast-forwarding ${input.defaultBranch} in ${checkedOut} failed: ${merged.stderr.trim()}`,
        };
      }
    } else {
      yield* git(cwd, ["update-ref", `refs/heads/${input.defaultBranch}`, head, base]);
    }
    return { landed: true as const, head };
  });

  return PivotGit.of({
    isRepository: (cwd) =>
      succeeds(cwd, ["rev-parse", "--is-inside-work-tree"]).pipe(Effect.orElseSucceed(() => false)),
    hasRemote,
    defaultBranch,
    branchExists,
    listBranches: (cwd, prefix) =>
      git(cwd, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`]).pipe(
        Effect.map((out) => out.split("\n").filter((line) => line.length > 0)),
      ),
    headCommit: (cwd) => git(cwd, ["rev-parse", "HEAD"]),
    isClean,
    landed,
    fastForward,
    remoteBranchCommit: (cwd, branch) =>
      git(cwd, ["ls-remote", "origin", `refs/heads/${branch}`]).pipe(
        Effect.map((out) => out.split(/\s+/)[0] || null),
      ),
  });
});

export const layer = Layer.effect(PivotGit, make);
