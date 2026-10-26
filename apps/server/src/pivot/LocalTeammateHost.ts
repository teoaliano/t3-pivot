/**
 * LocalTeammateHost - the home's own environment as a teammate host: V2 threads,
 * git worktrees and pull requests reached through PivotThreads and PivotGit.
 *
 * @module LocalTeammateHost
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as KeyedLock from "@t3tools/shared/KeyedLock";

import { ServerConfig } from "../config.ts";
import {
  BRIEF_TEXTS,
  definitionOfDoneText,
  inlineBranchBase,
  PIVOT_WORKSPACE_DIRNAME,
  renderBrief,
  teammateBranchBase,
  uniqueBranch,
} from "./pivotBrief.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotStore from "./PivotStore.ts";
import { loadPivotText } from "./pivotTexts.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost } from "./TeammateHost.ts";
import { removeTeammateTemp } from "./teammateTemp.ts";

export const make = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  const threads = yield* PivotThreads.PivotThreads;
  const git = yield* PivotGit.PivotGit;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Creating a Pivot or a teammate spans two databases; one at a time per project.
  const projectLocks = yield* KeyedLock.make<string>();
  // How the setup script went for an inline task that created the Pivot's workspace. V2's
  // setup tracker never sees it: the workspace is not a launch's worktree.
  const inlineSetups = new Map<string, PivotThreads.SetupScriptOutcome>();

  const refuse = (command: string, reason: string) =>
    new PivotStore.PivotRefusedError({ command, reason });

  const text = (name: string) =>
    loadPivotText(name).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  /** The project, refusing one that is gone or not a git repository. */
  const gitProject = (command: string, projectId: Parameters<typeof threads.project>[0]) =>
    Effect.gen(function* () {
      const project = yield* threads.project(projectId);
      if (project === null) return yield* refuse(command, `Project ${projectId} was not found.`);
      if (!(yield* git.isRepository(project.workspaceRoot))) {
        return yield* refuse(
          command,
          "Pivot mode needs a git repository: every teammate works in its own worktree.",
        );
      }
      return project;
    });

  // An inline task: a small change made in the Pivot's workspace, one at a time per project.
  // The workspace is made once, with the project's setup script, and reused after that.
  const launchInline = Effect.fn("LocalTeammateHost.launchInline")(function* (
    command: string,
    input: Parameters<TeammateHost["Service"]["launch"]>[0],
    projectRoot: string,
    deliveryMode: "direct-pr" | "local-only",
  ) {
    const busy = (yield* store.listTeammates({ includeTornDown: false })).find(
      (teammate) => teammate.projectId === input.projectId && teammate.kind === "inline",
    );
    if (busy !== undefined) {
      return yield* refuse(
        command,
        `One inline task at a time: "${busy.title}" (${busy.threadId}) is still open. Tear it down once it lands, or dispatch a ship for this one.`,
      );
    }
    if (input.baseBranch !== undefined) {
      return yield* refuse(
        command,
        "An inline task starts from the default branch. Stack work on another branch with a ship.",
      );
    }
    const baseBranch = yield* git.defaultBranch(projectRoot);
    const taken = new Set<string>(yield* git.listBranches(projectRoot, "pivot-inline/"));
    for (const teammate of yield* store.listTeammates({ includeTornDown: true })) {
      if (teammate.projectId === input.projectId) taken.add(teammate.branch);
    }
    const branch = uniqueBranch(inlineBranchBase(input.title), (candidate) => taken.has(candidate));
    const worktreePath = path.join(
      config.worktreesDir,
      path.basename(projectRoot),
      PIVOT_WORKSPACE_DIRNAME,
    );
    const { created } = yield* git
      .startWorkspaceBranch({ projectRoot, path: worktreePath, branch, defaultBranch: baseBranch })
      .pipe(
        Effect.catchTags({
          PivotWorkspaceDirtyError: (error) =>
            Effect.fail(
              refuse(
                command,
                `${error.message} Find out whose they are before the next inline task; a teammate can commit or discard them.`,
              ),
            ),
        }),
      );
    const definitionOfDone = [
      yield* text(BRIEF_TEXTS.inline),
      yield* text(definitionOfDoneText("ship", deliveryMode)),
    ].join("\n\n");
    const brief = renderBrief(yield* text(BRIEF_TEXTS.brief), {
      title: input.title,
      kind: input.kind,
      intent: input.intent,
      spec: input.spec,
      branch,
      baseBranch,
      worktreePath,
      definitionOfDone,
    });
    const launched = yield* threads.launchInline({
      projectId: input.projectId,
      pivotThreadId: input.pivotThreadId,
      title: input.title,
      branch,
      worktreePath,
      modelSelection: input.modelSelection,
      text: brief,
      runSetup: created,
    });
    if (launched.setup !== null) inlineSetups.set(launched.threadId, launched.setup);
    return {
      threadId: launched.threadId,
      runId: launched.runId,
      branch,
      baseBranch,
      worktreePath,
      deliveryMode,
    };
  });

  return TeammateHost.of({
    withProjectLock: projectLocks.withLock,
    project: gitProject,

    launch: (input) =>
      Effect.gen(function* () {
        const command = "dispatch_teammate";
        const project = yield* gitProject(command, input.projectId);
        const deliveryMode = (yield* git.hasRemote(project.workspaceRoot))
          ? ("direct-pr" as const)
          : ("local-only" as const);
        if (input.kind === "inline") {
          return yield* launchInline(command, input, project.workspaceRoot, deliveryMode);
        }
        const baseBranch = input.baseBranch ?? (yield* git.defaultBranch(project.workspaceRoot));
        const taken = new Set<string>(yield* git.listBranches(project.workspaceRoot, "pivot/"));
        for (const teammate of yield* store.listTeammates({ includeTornDown: true })) {
          if (teammate.projectId === input.projectId) taken.add(teammate.branch);
        }
        const repoName = path.basename(project.workspaceRoot);
        const worktreeFor = (branch: string) =>
          path.join(config.worktreesDir, repoName, branch.replace(/\//g, "-"));
        // A leftover directory would make `git worktree add` fail, so it counts as taken.
        const base = teammateBranchBase(input.title);
        let branch = uniqueBranch(base, (candidate) => taken.has(candidate));
        while (yield* fs.exists(worktreeFor(branch)).pipe(Effect.orElseSucceed(() => false))) {
          taken.add(branch);
          branch = uniqueBranch(base, (candidate) => taken.has(candidate));
        }
        const worktreePath = worktreeFor(branch);
        const brief = renderBrief(yield* text(BRIEF_TEXTS.brief), {
          title: input.title,
          kind: input.kind,
          intent: input.intent,
          spec: input.spec,
          branch,
          baseBranch,
          worktreePath,
          definitionOfDone: yield* text(definitionOfDoneText(input.kind, deliveryMode)),
        });
        const launched = yield* threads.launchTeammate({
          projectId: input.projectId,
          pivotThreadId: input.pivotThreadId,
          title: input.title,
          branch,
          baseBranch,
          modelSelection: input.modelSelection,
          text: brief,
        });
        return {
          threadId: launched.threadId,
          runId: launched.runId,
          branch,
          baseBranch,
          worktreePath,
          deliveryMode,
        };
      }),

    awaitStart: threads.awaitStart,
    setupOutcome: (threadId) => {
      const inline = inlineSetups.get(threadId);
      return inline === undefined ? threads.setupOutcome(threadId) : Effect.succeed(inline);
    },
    // Archiving does not interrupt a run still preparing its worktree, which would go on to run
    // the setup script and start an agent. A stop does, so it comes first; if it fails the thread
    // is archived anyway.
    discard: (threadId) =>
      threads.stop(threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not stop a discarded teammate thread", { threadId, cause }),
        ),
        Effect.andThen(threads.archive(threadId)),
      ),
    send: ({ threadId, senderThreadId, text, attachments }) =>
      threads.send({ threadId, senderThreadId, text, attachments, mode: "queue" }),
    stop: threads.stop,
    stopServers: threads.stopServers,
    // Landed or merged: the session stops first, so the agent never sees its own process
    // killed under it, and then what its scope still runs goes.
    stopScope: (threadId) =>
      threads
        .stop(threadId)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not stop the landed teammate's session", { threadId, cause }),
          ),
        ),
    retryLaunch: threads.retryLaunch,
    relaunch: threads.relaunch,
    pullRequestDetail: threads.pullRequestDetail,
    mergePullRequest: threads.mergePullRequest,

    landed: (command, input) =>
      Effect.gen(function* () {
        const project = yield* gitProject(command, input.projectId);
        return yield* git.landed({
          projectRoot: project.workspaceRoot,
          worktreePath: input.worktreePath,
          branch: input.branch,
          defaultBranch: yield* git.defaultBranch(project.workspaceRoot),
          mergedPullRequestHead: input.mergedPullRequestHead,
        });
      }),

    land: (command, input) =>
      Effect.gen(function* () {
        const project = yield* gitProject(command, input.projectId);
        if (!(yield* git.isClean(input.worktreePath))) {
          return {
            type: "refused",
            reason: "The teammate's worktree has uncommitted changes; it commits them first.",
          } as const;
        }
        const defaultBranch = yield* git.defaultBranch(project.workspaceRoot);
        const result = yield* git.fastForward({
          projectRoot: project.workspaceRoot,
          branch: input.branch,
          defaultBranch,
        });
        return result.landed
          ? ({ type: "landed", head: result.head, defaultBranch } as const)
          : ({ type: "refused", reason: result.reason } as const);
      }),

    worktreeExists: (worktreePath) =>
      fs.exists(worktreePath).pipe(Effect.orElseSucceed(() => false)),
    worktreeClean: git.isClean,

    teardown: (command, input) =>
      Effect.gen(function* () {
        const project = yield* gitProject(command, input.projectId);
        // The session goes first; if it will not stop, nothing else is touched.
        yield* threads.stop(input.threadId);
        yield* threads.stopProcesses(input.worktreePath);
        yield* removeTeammateTemp(input.worktreePath).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
        if (input.inline === true) {
          // The Pivot's workspace stays for the next inline task, back on a clean default branch.
          inlineSetups.delete(input.threadId);
          yield* git
            .resetWorkspace({
              path: input.worktreePath,
              defaultBranch: yield* git.defaultBranch(project.workspaceRoot),
              force: input.force,
            })
            .pipe(
              Effect.catchTags({
                PivotWorkspaceDirtyError: (error) => Effect.fail(refuse(command, error.message)),
              }),
            );
        } else if (input.worktreeExists) {
          yield* Effect.logInfo("Removing teammate worktree", { path: input.worktreePath });
          yield* threads.removeWorktree({
            projectRoot: project.workspaceRoot,
            worktreePath: input.worktreePath,
            force: input.force,
          });
        }
        yield* threads.archive(input.threadId);
        // Last, so a teardown that stops early still finds the branch it verified.
        if (input.branchDisposal !== "keep") {
          // A branch that cannot go (checked out elsewhere, unmerged, moved past the
          // verified tip) stays.
          yield* git
            .deleteBranch({
              projectRoot: project.workspaceRoot,
              branch: input.branch,
              tip: input.branchDisposal === "safe" ? undefined : input.branchDisposal.tip,
            })
            .pipe(
              Effect.tap(() => Effect.logInfo("Deleted teammate branch", { branch: input.branch })),
              Effect.catch((cause) =>
                Effect.logWarning("Kept teammate branch", { branch: input.branch, cause }),
              ),
            );
        }
      }),
  });
});

export const layer = Layer.effect(TeammateHost, make);
