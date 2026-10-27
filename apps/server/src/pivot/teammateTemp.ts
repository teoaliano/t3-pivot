// @effect-diagnostics nodeBuiltinImport:off -- the temp root is the host's.
import * as NodeOS from "node:os";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * Where Claude keeps per-session scratch: `<tmpdir>/claude-<uid>`. A reference so
 * tests point it at a fake directory.
 */
export const ClaudeTempRoot = Context.Reference<string>("t3/pivot/ClaudeTempRoot", {
  defaultValue: () => `${NodeOS.tmpdir()}/claude-${NodeOS.userInfo().uid}`,
});

/**
 * Claude names a project's temp directory after its working directory, every
 * character that is not a letter or digit written as `-`.
 */
export const claudeTempName = (worktreePath: string) => worktreePath.replace(/[^a-zA-Z0-9]/g, "-");

/**
 * Deletes the Claude temp directory of the teammate's worktree: its sessions'
 * scratch, tasks and outputs. Nothing else is touched, and nothing outside the
 * root; the worktree itself, its branch and its history stay.
 */
export const removeTeammateTemp = Effect.fn("TeammateTemp.removeTeammateTemp")(function* (
  worktreePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* ClaudeTempRoot;
  if (!path.isAbsolute(worktreePath) || worktreePath === "/") return;
  const directory = path.join(root, claudeTempName(worktreePath));
  if (!directory.startsWith(`${root}/`)) return;
  if (!(yield* fs.exists(directory).pipe(Effect.orElseSucceed(() => false)))) return;
  yield* fs.remove(directory, { recursive: true, force: true }).pipe(
    Effect.tap(() => Effect.logInfo("Removed teammate temp files", { path: directory })),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not remove teammate temp files", { path: directory, cause }),
    ),
  );
});
