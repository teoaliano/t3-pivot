/**
 * Worktrees use isolated .t3 state; ambient T3CODE_HOME could otherwise select the live userdata database.
 * T3 Pivot gives the main checkout one too: its developers run T3 Code from the same `~/.t3`,
 * where `~/.t3/dev` would sit beside the live install and `t3 pair` would find the live server first.
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

// Match worktrees/<name>; bare repos and GIT_COMMON_DIR need not use a directory named .git.
const pointsAtLinkedWorktree = (gitFileContents: string, path: Path.Path): boolean => {
  const gitdir = gitFileContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("gitdir:"))
    ?.slice("gitdir:".length)
    .trim();
  if (gitdir === undefined || gitdir.length === 0) {
    return false;
  }
  const segments = path
    .normalize(gitdir.replaceAll("\\", "/"))
    .split(/[/\\]/)
    .filter((segment) => segment.length > 0);
  return segments.length >= 3 && segments.at(-2) === "worktrees";
};

export const resolveGitWorktreePath = Effect.fn("devHome.resolveGitWorktreePath")(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  let directory = path.resolve(cwd);
  for (;;) {
    const gitPath = path.join(directory, ".git");
    const info = yield* fileSystem.stat(gitPath).pipe(Effect.option);
    if (Option.isSome(info)) {
      if (info.value.type !== "File") {
        return undefined;
      }
      const contents = yield* fileSystem
        .readFileString(gitPath)
        .pipe(Effect.orElseSucceed(() => ""));
      return pointsAtLinkedWorktree(contents, path) ? directory : undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
});

/**
 * The checkout-local data directory for `cwd`: `<root>/.t3` in a linked
 * worktree or a main checkout, undefined outside a repository or in a
 * submodule. Deliberately does not require the directory to exist yet: falling
 * back because it is missing would send callers at the shared home.
 */
export const resolveWorktreeT3Home = Effect.fn("devHome.resolveWorktreeT3Home")(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;
  const worktreePath = yield* resolveGitWorktreePath(cwd);
  const checkoutPath = worktreePath ?? (yield* resolveMainCheckoutPath(cwd));
  return checkoutPath === undefined ? undefined : path.join(checkoutPath, ".t3");
});

/** The main checkout containing `cwd`: the nearest directory whose `.git` is a directory. */
const resolveMainCheckoutPath = Effect.fn("devHome.resolveMainCheckoutPath")(function* (
  cwd: string,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  let directory = path.resolve(cwd);
  for (;;) {
    const info = yield* fileSystem.stat(path.join(directory, ".git")).pipe(Effect.option);
    if (Option.isSome(info)) {
      return info.value.type === "Directory" ? directory : undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
});
