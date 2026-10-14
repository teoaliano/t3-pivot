/**
 * PivotHost - what this environment does as a host for another environment's Pivot:
 * it runs teammates the home asks for, in this environment's own projects, worktrees,
 * providers and forge credentials, and logs what happens to them for the home to read.
 *
 * Every method authorizes the caller first (PivotHostAuthorization), then calls the
 * local TeammateHost, the same seam the Pivot's own teammates run through. This
 * environment holds no Pivot for these teammates: it keeps a record of each and a log,
 * and the home keeps everything else. Grant management is here too, without a transport:
 * no pairing, RPC or tool creates a link yet.
 *
 * @module PivotHost
 */
import {
  type EnvironmentId,
  PivotHostBranchName,
  PivotHostError,
  type RepositoryIdentity,
  ThreadId as ThreadIdBrand,
  type PivotHostDescription,
  type PivotHostEvent,
  type PivotHostLandResult,
  type PivotHostLaunchInput,
  type PivotHostLaunchResult,
  type PivotHostMergeInput,
  type PivotHostPullRequestInput,
  type PivotHostRunStart,
  type PivotHostSendInput,
  type PivotHostTeardownInput,
  type ProjectId,
  type PullRequestDetail,
  type ServerSettingsError,
  type ThreadId,
} from "@t3tools/contracts";
import { repositoryGroupingKeyOf } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as PivotGit from "./PivotGit.ts";
import * as Authorization from "./PivotHostAuthorization.ts";
import { PivotHostRefusedError, type PivotHostCaller } from "./PivotHostAuthorization.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost, type TeammateHostError } from "./TeammateHost.ts";

export type PivotHostServiceError = PivotHostRefusedError | TeammateHostError | ServerSettingsError;

type Result<A> = Effect.Effect<A, PivotHostServiceError>;

/** Entries read from the log at a time while a replay catches up. */
export const EVENTS_PAGE = 200;
/** A link may run this many teammates at once. */
export const PIVOT_HOST_MAX_LIVE_TEAMMATES = 16;
/** A link may hold this many `events` streams open at once. */
export const PIVOT_HOST_MAX_EVENT_STREAMS = 4;
/** What the host tells the home about a failure, such as a V2 error or a setup script's output, stops here. */
const DETAIL_MAX_LENGTH = 300;

const isBranchName = Schema.is(PivotHostBranchName);

/** Absolute paths read like the host's own file layout, which the home has no use for. */
const PATH_PATTERN = /(?:[A-Za-z]:\\[^\s'"]*|(?<![\w.])\/(?:[\w.~@+-]+\/?)+)/g;

/** A failure's text for the home: paths redacted and bounded. */
export const redactDetail = (detail: string | null) => {
  if (detail === null) return null;
  const redacted = detail.replace(PATH_PATTERN, "<path>");
  return redacted.length <= DETAIL_MAX_LENGTH
    ? redacted
    : `${redacted.slice(0, DETAIL_MAX_LENGTH - 1)}…`;
};

/**
 * What a failed host call looks like to the home. A refusal the host chose to make keeps its
 * message; any other failure, from the store, V2, git or settings, says only that it failed,
 * because its message and cause can name paths, SQL or provider output.
 */
export const pivotHostWireError = (cause: PivotHostServiceError) =>
  cause._tag === "PivotHostRefusedError"
    ? new PivotHostError({ reason: cause.code, message: cause.message })
    : cause._tag === "PivotRefusedError"
      ? new PivotHostError({ reason: "refused", message: cause.message })
      : new PivotHostError({
          reason: "failed",
          message: "The host could not complete that request.",
        });

/** Whether a PR's repository is the one the allowlisted project lives in. */
export const repositoryMatchesProject = (
  identity: RepositoryIdentity | null,
  link: { readonly host?: string | undefined; readonly repository: string },
) => {
  // A bare name could be anyone's `name` in another owner's namespace.
  if (identity === null || !link.repository.includes("/")) return false;
  const repository = link.repository.toLowerCase();
  return [identity.canonicalKey, identity.origin?.canonicalKey].some((key) => {
    if (key === undefined) return false;
    const lowered = key.toLowerCase();
    return link.host === undefined
      ? lowered.endsWith(`/${repository}`)
      : lowered === `${link.host.toLowerCase()}/${repository}`;
  });
};

/**
 * The sender id a hosted teammate's messages carry on this host. The home's Pivot thread id
 * is the home's, and could equal one of this host's own thread ids; namespacing it keeps the
 * teammate's messages from ever reading as a local thread's, with nothing to look up.
 */
export const hostedSenderOf = (pivotThreadId: ThreadId) =>
  ThreadIdBrand.make(`pivot-home:${pivotThreadId}`);

export class PivotHost extends Context.Service<
  PivotHost,
  {
    /** The allowed projects, and the host's own teammate models. */
    readonly describe: (
      caller: PivotHostCaller,
      input: { readonly homeEnvironmentId: EnvironmentId },
    ) => Result<PivotHostDescription>;
    /**
     * Launches a teammate and records it before its first run starts. A retry with the
     * same `dispatchId` returns the teammate that launch made instead of making another.
     */
    readonly launchTeammate: (
      caller: PivotHostCaller,
      input: PivotHostLaunchInput,
    ) => Result<PivotHostLaunchResult>;
    /** A message from the Pivot, queued behind the teammate's active turn. */
    readonly send: (caller: PivotHostCaller, input: PivotHostSendInput) => Result<void>;
    readonly stop: (caller: PivotHostCaller, input: TeammateInput) => Result<void>;
    readonly relaunch: (
      caller: PivotHostCaller,
      input: PivotHostSendInput,
    ) => Result<PivotHostRunStart>;
    readonly retryLaunch: (
      caller: PivotHostCaller,
      input: TeammateInput,
    ) => Result<PivotHostRunStart>;
    readonly settle: (caller: PivotHostCaller, input: TeammateInput) => Result<void>;
    /**
     * Stops the session and managed processes, removes the worktree and archives the
     * thread. Without `force`, a worktree with uncommitted changes is refused.
     */
    readonly teardown: (caller: PivotHostCaller, input: PivotHostTeardownInput) => Result<void>;
    /** The live state of one of the teammate's own pull requests. */
    readonly pullRequestDetail: (
      caller: PivotHostCaller,
      input: PivotHostPullRequestInput,
    ) => Result<PullRequestDetail>;
    /** Squash-merges one of the teammate's own pull requests, pinned to `expectedHeadSha`. */
    readonly mergePullRequest: (
      caller: PivotHostCaller,
      input: PivotHostMergeInput,
    ) => Result<void>;
    /** Fast-forwards the default branch to the teammate's branch, or says why it cannot. */
    readonly land: (caller: PivotHostCaller, input: TeammateInput) => Result<PivotHostLandResult>;
    /**
     * The grant's log after `afterSequence`, then each new entry as it is appended.
     * Entries of a project that left the allowlist are skipped. Ends when the link is
     * revoked.
     */
    readonly events: (
      caller: PivotHostCaller,
      input: { readonly homeEnvironmentId: EnvironmentId; readonly afterSequence: number },
    ) => Stream.Stream<PivotHostEvent, PivotHostServiceError>;

    // Grant management. These take no caller: they are for the environment's own user.

    /** A new host link allowing `allowedProjectIds`. It carries no credential. */
    readonly createGrant: (input: {
      readonly allowedProjectIds: ReadonlyArray<ProjectId>;
    }) => Result<PivotHostStore.HostGrant>;
    /** Every link with its allowlist and bound home, revoked ones included. */
    readonly listGrants: Effect.Effect<
      ReadonlyArray<PivotHostStore.HostGrant>,
      PivotStore.PivotStoreError
    >;
    /** Replaces the allowlist. Open sessions see it on their next call. */
    readonly setGrantAllowlist: (
      grantId: string,
      allowedProjectIds: ReadonlyArray<ProjectId>,
    ) => Result<PivotHostStore.HostGrant>;
    /** Ends the link: it refuses every call, loses its allowlist and bound home, and open streams end. */
    readonly revokeGrant: (grantId: string) => Result<void>;
  }
>()("t3/pivot/PivotHost") {}

type TeammateInput = { readonly homeEnvironmentId: EnvironmentId; readonly threadId: ThreadId };

export const make = Effect.gen(function* () {
  const store = yield* PivotHostStore.PivotHostStore;
  const host = yield* TeammateHost;
  const threads = yield* PivotThreads.PivotThreads;
  const git = yield* PivotGit.PivotGit;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const refuse = (command: string, reason: string) =>
    new PivotStore.PivotRefusedError({ command, reason });

  // One launch per dispatchId at a time, so a retry (or the same id sent for another project)
  // waits and finds the first. Taken before the project lock, never inside it.
  const dispatchLocks = yield* KeyedLock.make<string>();
  // Open `events` streams per grant.
  const openStreams = new Map<string, number>();

  const authorize = (...args: Parameters<typeof Authorization.authorize>) =>
    Authorization.authorize(...args).pipe(
      Effect.provideService(PivotHostStore.PivotHostStore, store),
    );
  const authorizeTeammate = (...args: Parameters<typeof Authorization.authorizeTeammate>) =>
    Authorization.authorizeTeammate(...args).pipe(
      Effect.provideService(PivotHostStore.PivotHostStore, store),
    );

  /** A teammate that can still be acted on. A torn-down one refuses. */
  const liveTeammate = (command: string, caller: PivotHostCaller, input: TeammateInput) =>
    Effect.gen(function* () {
      const target = yield* authorizeTeammate(caller, input);
      if (target.teammate.tornDownAt !== null) {
        return yield* refuse(command, `Teammate ${input.threadId} was torn down.`);
      }
      return target.teammate;
    });

  /** Where the teammate's worktree is: the path V2 recorded once it exists, else the one launched with. */
  const worktreeOf = (teammate: PivotHostStore.HostedTeammate) =>
    threads.shell(teammate.threadId).pipe(
      Effect.map((shell) => shell?.worktreePath ?? teammate.worktreePath),
      Effect.orElseSucceed(() => teammate.worktreePath),
    );

  const runStart = (start: PivotThreads.RunStart): PivotHostRunStart => ({
    outcome: start.type,
    runId: start.runId,
    detail: start.type === "failed" ? redactDetail(start.detail) : null,
  });

  const describe: PivotHost["Service"]["describe"] = (caller, input) =>
    Effect.gen(function* () {
      const grant = yield* authorize(caller, input);
      const settings = yield* serverSettings.getSettings;
      const projects: Array<PivotHostDescription["projects"][number]> = [];
      for (const projectId of grant.allowedProjectIds) {
        // A project that is gone or is not a git repository cannot host a teammate.
        const project = yield* host.project("pivotHost.describe", projectId).pipe(Effect.option);
        if (Option.isNone(project)) continue;
        const hasRemote = yield* git
          .hasRemote(project.value.workspaceRoot)
          .pipe(Effect.orElseSucceed(() => false));
        projects.push({
          projectId,
          title: project.value.title,
          repositoryKey:
            project.value.repositoryIdentity === null
              ? null
              : repositoryGroupingKeyOf(project.value.repositoryIdentity),
          hasRemote,
          teammateModels: resolveProjectSettings(settings, projectId).settings.teammateModels,
        });
      }
      return { projects, teammateModels: settings.teammateModels };
    });

  const launchResult = (
    teammate: PivotHostStore.HostedTeammate,
    start: PivotThreads.RunStart,
    setup: PivotThreads.SetupScriptOutcome,
  ): PivotHostLaunchResult => ({
    threadId: teammate.threadId,
    branch: teammate.branch,
    baseBranch: teammate.baseBranch,
    worktreePath: teammate.worktreePath,
    deliveryMode: teammate.deliveryMode,
    runId: teammate.firstRunId,
    firstRun: start.type,
    detail: start.type === "failed" ? redactDetail(start.detail) : null,
    setupScript: setup.status,
    setupDetail: redactDetail(setup.detail),
  });

  /** Where the first run stands, for a launch just made or one being retried. */
  const firstRun = (teammate: PivotHostStore.HostedTeammate) =>
    Effect.gen(function* () {
      const start: PivotThreads.RunStart =
        teammate.firstRunId === null
          ? { type: "failed", runId: null, detail: "The launch created no run." }
          : yield* host.awaitStart(teammate.threadId, teammate.firstRunId);
      // A failing setup script still starts the teammate; the result says so.
      return launchResult(teammate, start, yield* host.setupOutcome(teammate.threadId));
    });

  const differentLaunch = (command: string) =>
    refuse(command, "That dispatchId was used for a different launch.");

  const launchTeammate: PivotHost["Service"]["launchTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "pivotHost.launchTeammate";
      const first = yield* authorize(caller, input);
      // It reaches git, so a value that is not a plausible ref name is refused, not passed on.
      if (input.baseBranch !== undefined && !isBranchName(input.baseBranch)) {
        return yield* refuse(command, "The base branch is not a valid branch name.");
      }
      return yield* dispatchLocks.withLock(
        `${first.grantId}\u0000${input.dispatchId}`,
        host.withProjectLock(
          input.projectId,
          Effect.gen(function* () {
            // The link may have been revoked, or the project taken off it, while this waited.
            const grant = yield* authorize(caller, input);
            const existing = yield* store.findByDispatch(grant.grantId, input.dispatchId);
            if (existing !== null) {
              if (existing.projectId !== input.projectId) return yield* differentLaunch(command);
              if (existing.tornDownAt !== null) {
                return yield* refuse(command, "The teammate that dispatch launched was torn down.");
              }
              return yield* firstRun(existing);
            }
            if ((yield* store.countLive(grant.grantId)) >= PIVOT_HOST_MAX_LIVE_TEAMMATES) {
              return yield* refuse(
                command,
                `This host link already runs ${PIVOT_HOST_MAX_LIVE_TEAMMATES} teammates, the most it may. Tear one down first.`,
              );
            }
            const capReached = refuse(
              command,
              `This host link already runs ${PIVOT_HOST_MAX_LIVE_TEAMMATES} teammates, the most it may. Tear one down first.`,
            );
            // From launching to recording is one step that nothing may interrupt, such as a home
            // that drops its connection: a thread launched and left unrecorded would run
            // full-access with no record, uncounted, and out of a revoke's reach. Recorded
            // before the first run gets going, so its first report finds it. The link is checked
            // once more first: launching took a while, and a revoke or an allowlist edit in that
            // time ends the launch. The insert itself re-checks only that the link is not revoked,
            // so an edit landing between that check and the insert is not caught. Any way out but
            // success stops the thread, then archives it: archiving alone leaves a run still
            // preparing to go on and start its agent.
            const { launched, recorded } = yield* Effect.uninterruptible(
              Effect.gen(function* () {
                const launched = yield* host.launch({
                  projectId: input.projectId,
                  pivotThreadId: hostedSenderOf(input.pivotThreadId),
                  title: input.title,
                  kind: input.kind,
                  intent: input.intent,
                  spec: input.spec,
                  baseBranch: input.baseBranch,
                  modelSelection: input.modelSelection,
                });
                const { runId } = launched;
                const recorded = yield* Effect.gen(function* () {
                  yield* authorize(caller, input);
                  if (runId === null) return yield* refuse(command, "The launch created no run.");
                  const result = yield* store.recordTeammate(
                    {
                      threadId: launched.threadId,
                      grantId: grant.grantId,
                      dispatchId: input.dispatchId,
                      projectId: input.projectId,
                      pivotThreadId: input.pivotThreadId,
                      pivotLabel: input.pivotLabel,
                      kind: input.kind,
                      title: input.title,
                      branch: launched.branch,
                      baseBranch: launched.baseBranch,
                      worktreePath: launched.worktreePath,
                      deliveryMode: launched.deliveryMode,
                      firstRunId: runId,
                    },
                    { maxLive: PIVOT_HOST_MAX_LIVE_TEAMMATES },
                  );
                  if (result !== null) return result;
                  // Nothing was written: the link was revoked, the project left its allowlist,
                  // or another launch filled the cap.
                  const current = yield* store.getGrant(grant.grantId);
                  if (current === null || current.revokedAt !== null) {
                    return yield* new PivotHostRefusedError({
                      code: "revoked",
                      reason: "This Pivot host link was revoked.",
                    });
                  }
                  yield* authorize(caller, input);
                  return yield* capReached;
                }).pipe(
                  Effect.onExit((exit) =>
                    Exit.isSuccess(exit)
                      ? Effect.void
                      : host.discard(launched.threadId).pipe(Effect.ignore),
                  ),
                );
                return { launched, recorded };
              }),
            );
            if (!recorded.created) {
              // Another launch with this dispatchId won while this one ran; keep that one.
              yield* host.discard(launched.threadId).pipe(Effect.ignore);
              if (recorded.teammate.projectId !== input.projectId) {
                return yield* differentLaunch(command);
              }
            }
            return yield* firstRun(recorded.teammate);
          }),
        ),
      );
    });

  // A revoke or an allowlist edit can land while a send or a relaunch runs, and revoke
  // stops the link's threads only once. So the link is checked again afterwards, and a
  // teammate it no longer covers is stopped rather than left running.
  const recheck = (
    command: string,
    caller: PivotHostCaller,
    input: TeammateInput,
    threadId: ThreadId,
  ) =>
    liveTeammate(command, caller, input).pipe(
      Effect.tapError(() => stopUnreachable([threadId], "Could not stop an unreachable teammate")),
      Effect.asVoid,
    );

  const send: PivotHost["Service"]["send"] = (caller, input) =>
    Effect.gen(function* () {
      const teammate = yield* liveTeammate("pivotHost.send", caller, input);
      yield* host.send({
        threadId: teammate.threadId,
        senderThreadId: hostedSenderOf(teammate.pivotThreadId),
        text: input.text,
      });
      yield* recheck("pivotHost.send", caller, input, teammate.threadId);
    });

  const stop: PivotHost["Service"]["stop"] = (caller, input) =>
    Effect.gen(function* () {
      yield* host.stop((yield* liveTeammate("pivotHost.stop", caller, input)).threadId);
    });

  const relaunch: PivotHost["Service"]["relaunch"] = (caller, input) =>
    Effect.gen(function* () {
      const teammate = yield* liveTeammate("pivotHost.relaunch", caller, input);
      const started = yield* host.relaunch({
        threadId: teammate.threadId,
        senderThreadId: hostedSenderOf(teammate.pivotThreadId),
        text: input.text,
      });
      yield* recheck("pivotHost.relaunch", caller, input, teammate.threadId);
      return runStart(started);
    });

  const retryLaunch: PivotHost["Service"]["retryLaunch"] = (caller, input) =>
    Effect.gen(function* () {
      const teammate = yield* liveTeammate("pivotHost.retryLaunch", caller, input);
      const started = yield* host.retryLaunch(teammate.threadId);
      yield* recheck("pivotHost.retryLaunch", caller, input, teammate.threadId);
      return runStart(started);
    });

  const settle: PivotHost["Service"]["settle"] = (caller, input) =>
    Effect.gen(function* () {
      const teammate = yield* liveTeammate("pivotHost.settle", caller, input);
      yield* threads.settle(teammate.threadId);
    });

  const teardown: PivotHost["Service"]["teardown"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "pivotHost.teardown";
      const { teammate } = yield* authorizeTeammate(caller, input);
      // A retry after a lost response finds it already done.
      if (teammate.tornDownAt !== null) return;
      yield* host.project(command, teammate.projectId);
      const worktreePath = yield* worktreeOf(teammate);
      const worktreeExists = yield* host.worktreeExists(worktreePath);
      // Refused before anything stops: tearing down stops the session first, and removing a
      // dirty worktree then fails, leaving a stopped teammate behind a vague failure.
      if (!input.force && worktreeExists && !(yield* host.worktreeClean(worktreePath))) {
        return yield* new PivotHostRefusedError({
          code: "worktree-not-clean",
          reason:
            "The teammate's worktree has uncommitted changes. Tear it down with force to discard them.",
        });
      }
      yield* host.teardown(command, {
        projectId: teammate.projectId,
        threadId: teammate.threadId,
        worktreePath,
        branch: teammate.branch,
        worktreeExists,
        force: input.force,
        // The host cannot tell whether the home merged the work, so git decides: an unmerged
        // branch stays, and discarded work keeps its branch.
        branchDisposal: input.force ? "keep" : "safe",
      });
      yield* store.markTornDown(teammate.threadId);
    });

  /**
   * The ref of a pull request linked to the teammate's own thread. The home names one
   * of the teammate's PRs, never another one in the repository.
   */
  const linkedPullRequestRef = (
    command: string,
    teammate: PivotHostStore.HostedTeammate,
    input: PivotHostPullRequestInput,
  ) =>
    Effect.gen(function* () {
      const shell = yield* threads.shell(teammate.threadId);
      const project = yield* host.project(command, teammate.projectId);
      const link = (shell?.pullRequests ?? []).find(
        (candidate) =>
          candidate.source !== "stack-dismissed" &&
          candidate.repository === input.repository &&
          candidate.number === input.number &&
          (input.host === undefined || candidate.host === input.host),
      );
      // Linked to the teammate's thread, and in the repository the allowlisted project lives in.
      if (link === undefined || !repositoryMatchesProject(project.repositoryIdentity, link)) {
        return yield* refuse(command, "That pull request is not linked to this teammate.");
      }
      return {
        projectId: teammate.projectId,
        host: link.host,
        repository: link.repository,
        number: link.number,
      };
    });

  const pullRequestDetail: PivotHost["Service"]["pullRequestDetail"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "pivotHost.pullRequestDetail";
      const { teammate } = yield* authorizeTeammate(caller, input);
      return yield* host.pullRequestDetail(yield* linkedPullRequestRef(command, teammate, input));
    });

  const mergePullRequest: PivotHost["Service"]["mergePullRequest"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "pivotHost.mergePullRequest";
      const teammate = yield* liveTeammate(command, caller, input);
      const ref = yield* linkedPullRequestRef(command, teammate, input);
      yield* host.mergePullRequest({ ...ref, expectedHeadSha: input.expectedHeadSha });
    });

  const land: PivotHost["Service"]["land"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "pivotHost.land";
      const teammate = yield* liveTeammate(command, caller, input);
      const result = yield* host.land(command, {
        projectId: teammate.projectId,
        worktreePath: yield* worktreeOf(teammate),
        branch: teammate.branch,
      });
      return result.type === "landed"
        ? ({ _tag: "landed", head: result.head, defaultBranch: result.defaultBranch } as const)
        : ({ _tag: "refused", reason: redactDetail(result.reason) ?? "" } as const);
    });

  const events: PivotHost["Service"]["events"] = (caller, input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const opened = yield* authorize(caller, input);
        // The slot is taken and freed as one acquire and release, so an interruption at any point
        // cannot leak one.
        yield* Effect.acquireRelease(
          Effect.suspend(() => {
            const open = openStreams.get(opened.grantId) ?? 0;
            if (open >= PIVOT_HOST_MAX_EVENT_STREAMS) {
              return Effect.fail(
                refuse(
                  "pivotHost.events",
                  `This host link already has ${PIVOT_HOST_MAX_EVENT_STREAMS} events streams open, the most it may.`,
                ),
              );
            }
            openStreams.set(opened.grantId, open + 1);
            return Effect.void;
          }),
          () =>
            Effect.sync(() => {
              const remaining = (openStreams.get(opened.grantId) ?? 1) - 1;
              if (remaining <= 0) openStreams.delete(opened.grantId);
              else openStreams.set(opened.grantId, remaining);
            }),
        );
        // Subscribed before the first read, so nothing appended in between is missed.
        const changes = yield* store.subscribe;
        let cursor = input.afterSequence;

        /**
         * The next page of the log past the cursor, read as the link stands now, and whether
         * more may follow. A revoked link ends the stream with a null.
         */
        const readPage = Effect.gen(function* () {
          const grant = yield* authorize(caller, input);
          const page = yield* store.entriesAfter({
            grantId: grant.grantId,
            afterSequence: cursor,
            limit: EVENTS_PAGE,
          });
          const last = page.at(-1);
          if (last !== undefined) cursor = last.sequence;
          const entries = page
            .filter((entry) => grant.allowedProjectIds.includes(entry.projectId))
            .map((entry): PivotHostEvent => ({
              sequence: entry.sequence,
              threadId: entry.threadId,
              at: entry.occurredAt,
              event: entry.event,
            }));
          return [entries, page.length < EVENTS_PAGE ? Option.none() : Option.some(true)] as const;
        }).pipe(
          Effect.catchTags({
            PivotHostRefusedError: (error) =>
              error.code === "revoked"
                ? Effect.succeed([[null], Option.none()] as const)
                : Effect.fail(error),
          }),
        );

        // Each page goes out as it is read, so a long replay never sits in memory whole.
        // Any signal, for any link, is a reason to read: a read is cheap, and a signal that was
        // dropped for a slow reader is covered by whichever comes next.
        return Stream.concat(Stream.make(opened.grantId), changes).pipe(
          Stream.flatMap(() => Stream.paginate(true, () => readPage)),
          Stream.takeWhile((entry) => entry !== null),
        );
      }),
    );

  const checkProjects = (command: string, projectIds: ReadonlyArray<ProjectId>) =>
    Effect.forEach(projectIds, (projectId) =>
      threads
        .project(projectId)
        .pipe(
          Effect.flatMap((project) =>
            project === null
              ? Effect.fail(refuse(command, `Project ${projectId} was not found.`))
              : Effect.void,
          ),
        ),
    );

  const stopUnreachable = (threadIds: ReadonlyArray<ThreadId>, warning: string) =>
    Effect.forEach(
      threadIds,
      (threadId) =>
        Effect.gen(function* () {
          yield* host.stop(threadId);
          // Its dev servers too; they are not the session's to stop.
          const teammate = yield* store.getTeammate(threadId);
          if (teammate !== null) yield* threads.stopProcesses(yield* worktreeOf(teammate));
        }).pipe(Effect.catchCause((cause) => Effect.logWarning(warning, { threadId, cause }))),
      { discard: true },
    );

  const createGrant: PivotHost["Service"]["createGrant"] = (input) =>
    Effect.gen(function* () {
      yield* checkProjects("pivotHost.createGrant", input.allowedProjectIds);
      return yield* store.createGrant(input);
    });

  const setGrantAllowlist: PivotHost["Service"]["setGrantAllowlist"] = (grantId, projectIds) =>
    Effect.gen(function* () {
      const command = "pivotHost.setGrantAllowlist";
      yield* checkProjects(command, projectIds);
      const result = yield* store.setAllowlist(grantId, projectIds);
      if (result === null) {
        return yield* refuse(command, `Host link ${grantId} does not exist or was revoked.`);
      }
      // A project that left the list takes its teammates out of the home's reach, so they
      // stop the way a revoked link's do, keeping their worktrees.
      yield* stopUnreachable(
        result.dropped,
        "Could not stop a hosted teammate of a removed project",
      );
      return result.grant;
    });

  const revokeGrant: PivotHost["Service"]["revokeGrant"] = (grantId) =>
    Effect.gen(function* () {
      const grant = yield* store.getGrant(grantId);
      if (grant === null) {
        return yield* refuse("pivotHost.revokeGrant", `Host link ${grantId} does not exist.`);
      }
      yield* store.revokeGrant(grantId);
      // The link's teammates keep their worktrees, but stop: nothing that refuses their home
      // may leave them running full-access. Read after the revoke committed, so one recorded
      // before it is included and none can be recorded after; and read again by a repeat call,
      // so a stop that failed is tried again. Stopping a stopped thread is harmless.
      yield* stopUnreachable(
        yield* store.liveThreadIdsOf(grantId),
        "Could not stop a hosted teammate of a revoked host link",
      );
    });

  return PivotHost.of({
    describe,
    launchTeammate,
    send,
    stop,
    relaunch,
    retryLaunch,
    settle,
    teardown,
    pullRequestDetail,
    mergePullRequest,
    land,
    events,
    createGrant,
    listGrants: store.listGrants,
    setGrantAllowlist,
    revokeGrant,
  });
});

export const layer = Layer.effect(PivotHost, make);
