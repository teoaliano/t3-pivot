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

import { ServerConfig } from "../config.ts";
import {
  BRIEF_TEXTS,
  definitionOfDoneText,
  renderBrief,
  teammateBranchBase,
  uniqueBranch,
} from "./pivotBrief.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotStore from "./PivotStore.ts";
import { loadPivotText } from "./pivotTexts.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost } from "./TeammateHost.ts";

export const make = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  const threads = yield* PivotThreads.PivotThreads;
  const git = yield* PivotGit.PivotGit;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

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

  return TeammateHost.of({
    project: gitProject,

    launch: (input) =>
      Effect.gen(function* () {
        const command = "dispatch_teammate";
        const project = yield* gitProject(command, input.projectId);
        const deliveryMode = (yield* git.hasRemote(project.workspaceRoot))
          ? ("direct-pr" as const)
          : ("local-only" as const);
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
    setupOutcome: threads.setupOutcome,
    discard: threads.archive,
    send: ({ threadId, senderThreadId, text }) =>
      threads.send({ threadId, senderThreadId, text, mode: "queue" }),
    stop: threads.stop,
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
        if (input.worktreeExists) {
          yield* threads.removeWorktree({
            projectRoot: project.workspaceRoot,
            worktreePath: input.worktreePath,
            force: input.force,
          });
        }
        yield* threads.archive(input.threadId);
      }),
  });
});

export const layer = Layer.effect(TeammateHost, make);
