/**
 * PivotHome - the small git repository a project's Pivot runs in.
 *
 * One home per project lives under T3's userdata and is shared by the project's
 * active Pivot and every retired one. The Pivot runs here, not in the project, so
 * the project's own instructions never load into it. It is a git repository so
 * checkpoints (hidden git refs) work.
 *
 * @module PivotHome
 */
import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { loadPivotText } from "./pivotTexts.ts";

export class PivotHomeError extends Schema.TaggedError<PivotHomeError>()("PivotHomeError", {
  homePath: Schema.String,
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Pivot home ${this.operation} failed at ${this.homePath}.`;
  }
}

class GitExitError extends Schema.TaggedError<GitExitError>()("GitExitError", {
  subcommand: Schema.String,
  exitCode: Schema.NullOr(Schema.Number),
  stderr: Schema.String,
}) {}

export class PivotHome extends Context.Service<
  PivotHome,
  {
    /**
     * Creates the project's Pivot home if needed and brings `AGENTS.md` up to the
     * shipped contract, then returns its absolute path. Idempotent. `preferences.md`
     * is the user's and is created empty, never overwritten.
     */
    readonly ensure: (projectId: ProjectId) => Effect.Effect<string, PivotHomeError>;
  }
>()("t3/pivot/PivotHome") {}

// Claude Code reads CLAUDE.md, not AGENTS.md; this is the import form the repo's own CLAUDE.md uses.
const CLAUDE_MD = "@AGENTS.md\n";

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  // Concurrent ensures for one project would fight over git's index lock.
  const gate = yield* Semaphore.make(1);

  const ensureOnce = Effect.fn("PivotHome.ensure")(function* (projectId: ProjectId) {
    const homePath = path.join(config.stateDir, "pivot-homes", projectId);
    const fail = (operation: string) => (cause: unknown) =>
      new PivotHomeError({ homePath, operation, cause });

    const git = (...args: ReadonlyArray<string>) =>
      runner.run({ command: "git", args, cwd: homePath }).pipe(
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output)
            : Effect.fail(
                new GitExitError({
                  subcommand: args[0] ?? "",
                  exitCode: output.code,
                  stderr: output.stderr,
                }),
              ),
        ),
      );

    const writeIfChanged = Effect.fn("writeIfChanged")(function* (name: string, contents: string) {
      const file = path.join(homePath, name);
      const current = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
      if (current !== contents) yield* fs.writeFileString(file, contents);
    });

    const contract = yield* loadPivotText("AGENTS").pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(fail("load contract")),
    );

    yield* fs.makeDirectory(homePath, { recursive: true }).pipe(Effect.mapError(fail("mkdir")));

    yield* Effect.gen(function* () {
      if (!(yield* fs.exists(path.join(homePath, ".git")))) yield* git("init");
      // Local, so commits work on machines with no global git identity.
      yield* git("config", "user.name", "T3 Pivot");
      yield* git("config", "user.email", "pivot@t3.invalid");
      yield* git("config", "commit.gpgsign", "false");
      yield* git("config", "core.autocrlf", "false");

      yield* writeIfChanged("AGENTS.md", contract);
      yield* writeIfChanged("CLAUDE.md", CLAUDE_MD);
      const preferences = path.join(homePath, "preferences.md");
      if (!(yield* fs.exists(preferences))) yield* fs.writeFileString(preferences, "");

      // Leave the working tree clean so checkpoints start from a known state.
      const status = yield* git("status", "--porcelain");
      if (status.stdout.trim().length > 0) {
        yield* git("add", "-A");
        const head = yield* runner.run({
          command: "git",
          args: ["rev-parse", "--verify", "--quiet", "HEAD"],
          cwd: homePath,
        });
        yield* git(
          "commit",
          "--no-verify",
          "-m",
          head.code === 0 ? "Update Pivot home" : "Create Pivot home",
        );
      }
    }).pipe(Effect.mapError(fail("prepare")));

    return homePath;
  });

  return PivotHome.of({ ensure: (projectId) => gate.withPermits(1)(ensureOnce(projectId)) });
});

export const layer = Layer.effect(PivotHome, make);
