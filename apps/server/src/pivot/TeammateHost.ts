/**
 * TeammateHost - what the Pivot's home asks of the environment a teammate runs on:
 * its project, thread, worktree, git checkout and pull request.
 *
 * The home keeps every record; the host owns the files and processes. PivotService
 * calls only this seam, and picks the host by the teammate's environment (null is the
 * home). LocalTeammateHost is today's code and the only implementation.
 *
 * @module TeammateHost
 */
import type {
  PullRequestDetail,
  PullRequestRef,
  ModelSelection,
  PivotDeliveryMode,
  TeammateKind,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type * as PivotGit from "./PivotGit.ts";
import type * as PivotStore from "./PivotStore.ts";
import type * as PivotThreads from "./PivotThreads.ts";
import type { PivotTextError } from "./pivotTexts.ts";

/** What a host operation fails with. */
export type TeammateHostError =
  | PivotStore.PivotRefusedError
  | PivotStore.PivotStoreError
  | PivotThreads.PivotThreadsError
  | PivotGit.PivotGitError
  | PivotTextError;

type Result<A> = Effect.Effect<A, TeammateHostError>;

export interface LaunchTeammateInput {
  readonly projectId: ProjectId;
  readonly pivotThreadId: ThreadId;
  readonly title: string;
  readonly kind: TeammateKind;
  readonly intent: string;
  readonly spec: string;
  readonly baseBranch?: string | undefined;
  readonly modelSelection: ModelSelection;
}

/** A launched teammate: V2 accepted it, and the worktree is still being prepared. */
export interface LaunchedTeammate {
  readonly threadId: ThreadId;
  /** The first run. Null when the launch created none. */
  readonly runId: RunId | null;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly deliveryMode: PivotDeliveryMode;
}

/** Where a teammate's checkout stands, as the host's git sees it. */
export interface TeammateCheckout {
  readonly projectId: ProjectId;
  readonly worktreePath: string;
  readonly branch: string;
}

export class TeammateHost extends Context.Service<
  TeammateHost,
  {
    /** The project, refusing one that is gone or not a git repository. */
    readonly project: (command: string, projectId: ProjectId) => Result<PivotThreads.PivotProject>;
    /**
     * Picks the branch and worktree, renders the brief and launches the thread with it
     * as its first message from the Pivot.
     */
    readonly launch: (input: LaunchTeammateInput) => Result<LaunchedTeammate>;
    readonly awaitStart: (threadId: ThreadId, runId: RunId) => Result<PivotThreads.RunStart>;
    readonly setupOutcome: (threadId: ThreadId) => Effect.Effect<PivotThreads.SetupScriptOutcome>;
    /** Archives a launched thread whose record could not be written. */
    readonly discard: (threadId: ThreadId) => Result<void>;
    /** A message from the Pivot, queued behind the active turn. */
    readonly send: (input: {
      readonly threadId: ThreadId;
      readonly senderThreadId: ThreadId;
      readonly text: string;
    }) => Result<void>;
    readonly stop: (threadId: ThreadId) => Result<void>;
    readonly retryLaunch: (threadId: ThreadId) => Result<PivotThreads.RunStart>;
    readonly relaunch: (input: {
      readonly threadId: ThreadId;
      readonly senderThreadId: ThreadId;
      readonly text: string;
    }) => Result<PivotThreads.RunStart>;
    readonly pullRequestDetail: (ref: PullRequestRef) => Result<PullRequestDetail>;
    readonly mergePullRequest: (
      ref: PullRequestRef & { readonly expectedHeadSha: string },
    ) => Result<void>;
    /** Whether the checkout's work landed; see PivotGit.landed. */
    readonly landed: (
      command: string,
      input: TeammateCheckout & { readonly mergedPullRequestHead: string | null },
    ) => Result<PivotGit.LandedVerdict>;
    /** Fast-forwards the default branch to the branch, or says why it cannot. */
    readonly land: (
      command: string,
      input: TeammateCheckout,
    ) => Result<
      | { readonly type: "landed"; readonly head: string; readonly defaultBranch: string }
      | { readonly type: "refused"; readonly reason: string }
    >;
    readonly worktreeExists: (worktreePath: string) => Effect.Effect<boolean>;
    /** Whether the worktree has no uncommitted or untracked changes. */
    readonly worktreeClean: (worktreePath: string) => Result<boolean>;
    /**
     * Stops the session and managed processes, removes the worktree when it exists,
     * and archives the thread. Without `force`, a dirty worktree is refused.
     */
    readonly teardown: (
      command: string,
      input: TeammateCheckout & {
        readonly threadId: ThreadId;
        readonly worktreeExists: boolean;
        readonly force: boolean;
      },
    ) => Result<void>;
  }
>()("t3/pivot/TeammateHost") {}
