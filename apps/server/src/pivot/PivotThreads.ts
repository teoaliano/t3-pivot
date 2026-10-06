/**
 * PivotThreads - everything Pivot mode asks of V2 threads and projects.
 *
 * Pivot mode adds nothing to V2's database: a Pivot and its teammates are
 * ordinary V2 threads, and every message the Pivot sends carries it as the
 * sender. This module is the one place that turns Pivot actions into V2
 * commands, so the Pivot service can be tested against a fake V2.
 *
 * @module PivotThreads
 */
import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type OrchestrationV2DomainEvent,
  type PullRequestDetail,
  type PullRequestRef,
  type RunId,
  ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ManagedProcesses from "../managedProcess/ManagedProcesses.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { randomUuidV4 } from "../orchestration-v2/RandomUuid.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadLifecycle from "../orchestration-v2/ThreadLifecycleService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export class PivotThreadsError extends Schema.TaggedError<PivotThreadsError>()(
  "PivotThreadsError",
  {
    operation: Schema.String,
    threadId: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface PivotProject {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
}

/** How a run that was asked to start came out. */
export type RunStart =
  | { readonly type: "started"; readonly runId: RunId }
  | { readonly type: "failed"; readonly runId: RunId | null; readonly detail: string };

export interface TeammateLaunch {
  readonly threadId: ThreadId;
  /** The first run, preparing its worktree. Null when the launch created none. */
  readonly runId: RunId | null;
}

/** What the supervisor hears from V2, already narrowed to what Pivot mode acts on. */
export type PivotThreadEvent =
  | { readonly type: "activity"; readonly threadId: ThreadId }
  /** The user typed into the thread directly: no sender thread, not a notification. */
  | {
      readonly type: "user-message";
      readonly threadId: ThreadId;
      readonly messageId: string;
      readonly text: string;
    }
  /** The user answered an approval or question the thread's run was held on. */
  | { readonly type: "request-answered"; readonly threadId: ThreadId; readonly answer: string }
  | {
      readonly type: "pull-requests";
      readonly threadId: ThreadId;
      readonly links: ReadonlyArray<ThreadPullRequestLink>;
    };

export class PivotThreads extends Context.Service<
  PivotThreads,
  {
    readonly project: (
      projectId: ProjectId,
    ) => Effect.Effect<PivotProject | null, PivotThreadsError>;
    /** Creates the Pivot's thread in its home, full-access, never auto-settling. */
    readonly createPivotThread: (input: {
      readonly projectId: ProjectId;
      readonly homePath: string;
      readonly modelSelection: ModelSelection;
    }) => Effect.Effect<ThreadId, PivotThreadsError>;
    /**
     * Launches a teammate into a fresh worktree on `branch`, with `text` as its first
     * message from the Pivot. Returns once V2 accepted it; the worktree is still being
     * prepared.
     */
    readonly launchTeammate: (input: {
      readonly projectId: ProjectId;
      readonly pivotThreadId: ThreadId;
      readonly title: string;
      readonly branch: string;
      readonly baseBranch: string;
      readonly modelSelection: ModelSelection;
      readonly text: string;
    }) => Effect.Effect<TeammateLaunch, PivotThreadsError>;
    /** Waits until a run leaves preparation: started, or failed with V2's last error. */
    readonly awaitStart: (
      threadId: ThreadId,
      runId: RunId,
    ) => Effect.Effect<RunStart, PivotThreadsError>;
    /** Retries a teammate whose launch failed, reusing its recorded worktree. */
    readonly retryLaunch: (threadId: ThreadId) => Effect.Effect<RunStart, PivotThreadsError>;
    readonly archive: (threadId: ThreadId) => Effect.Effect<void, PivotThreadsError>;
    /** A message from `senderThreadId`, queued behind the active turn or steered into it. */
    readonly send: (input: {
      readonly threadId: ThreadId;
      readonly senderThreadId: ThreadId;
      readonly text: string;
      readonly mode: "auto" | "queue";
    }) => Effect.Effect<void, PivotThreadsError>;
    /** Interrupts the running turn, holds the queue, and ends the provider session. */
    readonly stop: (threadId: ThreadId) => Effect.Effect<void, PivotThreadsError>;
    /**
     * Ends the provider session and starts a new run that resumes the conversation
     * through the provider's resume cursor, with `text` from the Pivot.
     */
    readonly relaunch: (input: {
      readonly threadId: ThreadId;
      readonly senderThreadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<RunStart, PivotThreadsError>;
    readonly shell: (
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadShell | null, PivotThreadsError>;
    /** V2's live events, narrowed for the supervisor. Every thread's, not only teammates'. */
    readonly events: Stream.Stream<PivotThreadEvent>;
    /**
     * Posts a wake on the Pivot's thread as a `teammate` notification message. V2 steers
     * it into a running turn that steers without interrupting tools, joins it to a wake
     * still queued, or queues it.
     */
    readonly wake: (input: {
      readonly pivotThreadId: ThreadId;
      readonly messageId: MessageId;
      readonly text: string;
      readonly summary: string;
      readonly teammateThreadIds: ReadonlyArray<ThreadId>;
    }) => Effect.Effect<void, PivotThreadsError>;
    /** Whether a teammate wake is still queued on the Pivot's thread, undelivered. */
    readonly hasQueuedWake: (pivotThreadId: ThreadId) => Effect.Effect<boolean, PivotThreadsError>;
    /** The PR's live state, read from its forge. */
    readonly pullRequestDetail: (
      ref: PullRequestRef,
    ) => Effect.Effect<PullRequestDetail, PivotThreadsError>;
    /** Squash-merges the PR, refused by the forge unless its head is still `expectedHeadSha`. */
    readonly mergePullRequest: (
      ref: PullRequestRef & { readonly expectedHeadSha: string },
    ) => Effect.Effect<void, PivotThreadsError>;
    /** Stops every managed process the worktree runs and frees its port block. */
    readonly stopProcesses: (worktreePath: string) => Effect.Effect<void>;
    /** Removes the worktree; without `force`, T3's clean-tree check refuses a dirty one. */
    readonly removeWorktree: (input: {
      readonly projectRoot: string;
      readonly worktreePath: string;
      readonly force: boolean;
    }) => Effect.Effect<void, PivotThreadsError>;
  }
>()("t3/pivot/PivotThreads") {}

export const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const lifecycle = yield* ThreadLifecycle.ThreadLifecycleService;
  const projects = yield* ProjectService.ProjectService;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const processes = yield* ManagedProcesses.ManagedProcesses;
  const git = yield* GitWorkflow.GitWorkflowService;

  const fail = (operation: string, threadId?: string) => (cause: unknown) =>
    new PivotThreadsError({
      operation,
      ...(threadId === undefined ? {} : { threadId }),
      detail: cause instanceof Error ? cause.message : `Pivot ${operation} failed.`,
      cause,
    });
  const commandId = (operation: string) =>
    randomUuidV4.pipe(Effect.map((uuid) => CommandId.make(`pivot:${operation}:${uuid}`)));
  const messageId = randomUuidV4.pipe(
    Effect.map((uuid) => MessageId.make(`pivot-message-${uuid}`)),
  );

  /** Waits until `runId` leaves preparation: started, or failed with V2's last error. */
  const awaitRunStart = (threadId: ThreadId, runId: RunId) =>
    Effect.gen(function* () {
      const afterSequence = yield* threads.getThreadEventSequence(threadId);
      const readStatus = threads
        .getThreadRecords(threadId, ["runs"], { runIds: [runId] })
        .pipe(
          Effect.map((records) => records.runs.find((candidate) => candidate.id === runId)?.status),
        );
      const settled = (status: string | undefined) =>
        status !== undefined && status !== "preparing" && status !== "queued";
      let status = yield* readStatus;
      if (!settled(status)) {
        const next = yield* threads
          .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
          .pipe(
            Stream.mapEffect(() => readStatus),
            Stream.filter(settled),
            Stream.runHead,
          );
        status = Option.getOrUndefined(next);
      }
      if (status === "failed" || status === "cancelled" || status === undefined) {
        const shell = yield* threads.getThreadShell(threadId);
        const detail =
          shell?.lastError ??
          (status === "cancelled" ? "The run was cancelled." : "The run failed to start.");
        return { type: "failed", runId, detail } satisfies RunStart as RunStart;
      }
      return { type: "started", runId } satisfies RunStart as RunStart;
    });

  const latestRunId = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(Effect.map((shell) => shell?.latestRunId ?? null));

  const detachSessions = (threadId: ThreadId, operation: string) =>
    Effect.gen(function* () {
      const projection = yield* threads.getThreadProjection(threadId);
      const base = yield* commandId(operation);
      for (const session of projection.providerSessions) {
        yield* threads.dispatch({
          type: "provider-session.detach",
          commandId: CommandId.make(`${base}:detach:${session.id}`),
          threadId,
          providerSessionId: session.id,
          reason: "client-requested",
        });
      }
    });

  return PivotThreads.of({
    project: (projectId) =>
      projects.getById(projectId).pipe(
        Effect.map(
          Option.match({
            onNone: () => null,
            onSome: (project) => ({
              projectId: project.id,
              workspaceRoot: project.workspaceRoot,
              defaultModelSelection: project.defaultModelSelection,
            }),
          }),
        ),
        Effect.mapError(fail("read project")),
      ),

    createPivotThread: ({ projectId, homePath, modelSelection }) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(`thread-pivot-${yield* randomUuidV4}`);
        // Created directly rather than launched: a launch runs the project's
        // setup script in its workspace, and the home is not the project.
        yield* threads.dispatch({
          type: "thread.create",
          commandId: yield* commandId("create-pivot"),
          threadId,
          projectId,
          title: "Pivot",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: homePath,
          createdBy: "user",
          creationSource: "web",
        });
        // V2 refuses server wakes into a settled thread, so a Pivot never settles.
        yield* threads.dispatch({
          type: "thread.auto-settle.set",
          commandId: yield* commandId("pivot-auto-settle"),
          threadId,
          enabled: false,
        });
        return threadId;
      }).pipe(Effect.mapError(fail("create the Pivot thread"))),

    launchTeammate: (input) =>
      Effect.gen(function* () {
        const launched = yield* launches.launch({
          commandId: yield* commandId("dispatch"),
          projectId: input.projectId,
          title: input.title,
          modelSelection: input.modelSelection,
          // Teammates never wait on a human; the `waiting` wake is the safety net.
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: {
            type: "worktree",
            baseRef: input.baseBranch,
            branch: input.branch,
            startFromOrigin: true,
          },
          initialMessage: {
            messageId: yield* messageId,
            senderThreadId: input.pivotThreadId,
            text: input.text,
            attachments: [],
          },
          createdBy: "agent",
          creationSource: "mcp",
        });
        return { threadId: launched.threadId, runId: launched.projection.runs[0]?.id ?? null };
      }).pipe(Effect.mapError(fail("launch the teammate"))),

    awaitStart: (threadId, runId) =>
      awaitRunStart(threadId, runId).pipe(Effect.mapError(fail("await the run", threadId))),

    retryLaunch: (threadId) =>
      Effect.gen(function* () {
        const runId = yield* latestRunId(threadId);
        if (runId === null) {
          return {
            type: "failed",
            runId: null,
            detail: "The teammate has no run to retry.",
          } as RunStart;
        }
        yield* launches.retryPreparation({ commandId: yield* commandId("retry"), threadId, runId });
        return yield* awaitRunStart(threadId, runId);
      }).pipe(Effect.mapError(fail("retry the launch", threadId))),

    archive: (threadId) =>
      Effect.gen(function* () {
        yield* lifecycle.archive({ commandId: yield* commandId("archive"), threadId });
      }).pipe(Effect.mapError(fail("archive", threadId))),

    send: ({ threadId, senderThreadId, text, mode }) =>
      Effect.gen(function* () {
        const shell = yield* threads.getThreadShell(threadId);
        if (shell === null) return yield* fail("send", threadId)(new Error("Thread not found."));
        yield* threads.sendToThread({
          projectId: shell.projectId,
          commandId: yield* commandId("send"),
          threadId,
          messageId: yield* messageId,
          senderThreadId,
          text,
          attachments: [],
          mode,
          createdBy: "agent",
          creationSource: "mcp",
        });
      }).pipe(Effect.mapError(fail("send", threadId))),

    stop: (threadId) =>
      Effect.gen(function* () {
        yield* threads.dispatch({
          type: "thread.stop",
          commandId: yield* commandId("stop"),
          threadId,
          reason: "Stopped by the Pivot.",
        });
        yield* detachSessions(threadId, "stop");
      }).pipe(Effect.mapError(fail("stop", threadId))),

    relaunch: ({ threadId, senderThreadId, text }) =>
      Effect.gen(function* () {
        const shell = yield* threads.getThreadShell(threadId);
        if (shell === null)
          return yield* fail("relaunch", threadId)(new Error("Thread not found."));
        yield* threads.dispatch({
          type: "thread.stop",
          commandId: yield* commandId("relaunch-stop"),
          threadId,
          reason: "Relaunched by the Pivot.",
        });
        yield* detachSessions(threadId, "relaunch");
        const sent = yield* threads.sendToThread({
          projectId: shell.projectId,
          commandId: yield* commandId("relaunch"),
          threadId,
          messageId: yield* messageId,
          senderThreadId,
          text,
          attachments: [],
          mode: "auto",
          createdBy: "agent",
          creationSource: "mcp",
        });
        return yield* awaitRunStart(threadId, sent.run.id);
      }).pipe(Effect.mapError(fail("relaunch", threadId))),

    shell: (threadId) =>
      threads.getThreadShell(threadId).pipe(Effect.mapError(fail("read", threadId))),

    events: threads.streamDomainEvents.pipe(
      Stream.flatMap((event) => Stream.fromIterable(toPivotThreadEvents(event))),
      // A broken subscription resubscribes rather than leaving the supervisor deaf.
      Stream.retry(Schedule.spaced("1 second")),
      Stream.orDie,
    ),

    wake: ({ pivotThreadId, messageId, text, summary, teammateThreadIds }) =>
      Effect.gen(function* () {
        yield* threads.dispatch({
          type: "message.dispatch",
          commandId: yield* commandId("wake"),
          threadId: pivotThreadId,
          messageId,
          text,
          notification: {
            source: { kind: "teammate", teammateThreadIds: [...teammateThreadIds] },
            outcome: "updated",
            summary,
          },
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "agent",
          creationSource: "server",
        });
      }).pipe(Effect.mapError(fail("wake", pivotThreadId))),

    hasQueuedWake: (pivotThreadId) =>
      threads.getThreadRecords(pivotThreadId, ["runs", "messages"]).pipe(
        Effect.map((records) =>
          records.runs.some(
            (run) =>
              run.status === "queued" &&
              records.messages.some(
                (message) =>
                  message.id === run.userMessageId &&
                  message.notification?.source.kind === "teammate",
              ),
          ),
        ),
        Effect.mapError(fail("read the queue", pivotThreadId)),
      ),

    pullRequestDetail: (ref) => pullRequests.detail(ref).pipe(Effect.mapError(fail("read the PR"))),

    mergePullRequest: ({ expectedHeadSha, ...ref }) =>
      pullRequests
        .runAction({ ...ref, action: "merge", mergeMethod: "squash", expectedHeadSha })
        .pipe(Effect.mapError(fail("merge the PR"))),

    stopProcesses: (worktreePath) =>
      processes.stopAllForCheckout(worktreePath, { releaseReservation: true }),

    removeWorktree: ({ projectRoot, worktreePath, force }) =>
      git
        .removeWorktree({ cwd: projectRoot, path: worktreePath, force })
        .pipe(Effect.mapError(fail("remove the worktree"))),
  });
});

const describeAnswer = (
  request: Extract<OrchestrationV2DomainEvent, { type: "runtime-request.updated" }>["payload"],
) => {
  if (request.decision !== undefined) return `Approval: ${String(request.decision)}`;
  if (request.answers !== undefined) {
    return Object.values(request.answers)
      .map((answer) => (Array.isArray(answer) ? answer.join(", ") : String(answer)))
      .join("; ");
  }
  return "Answered.";
};

/** Narrows one V2 domain event to the Pivot thread events it carries. */
export const toPivotThreadEvents = (
  event: OrchestrationV2DomainEvent,
): ReadonlyArray<PivotThreadEvent> => {
  const activity: PivotThreadEvent = { type: "activity", threadId: event.threadId };
  switch (event.type) {
    case "message.updated": {
      const message = event.payload;
      const typedByUser =
        message.role === "user" &&
        message.createdBy === "user" &&
        message.senderThreadId === undefined &&
        message.notification === undefined;
      return typedByUser
        ? [
            activity,
            {
              type: "user-message",
              threadId: event.threadId,
              messageId: message.id,
              text: message.text,
            },
          ]
        : [activity];
    }
    case "runtime-request.updated":
      return event.payload.status === "resolved"
        ? [
            activity,
            {
              type: "request-answered",
              threadId: event.threadId,
              answer: describeAnswer(event.payload),
            },
          ]
        : [activity];
    case "thread.pull-request-synced":
      return [
        activity,
        {
          type: "pull-requests",
          threadId: event.threadId,
          links: event.payload.pullRequests ?? [],
        },
      ];
    default:
      return [activity];
  }
};

export const layer = Layer.effect(PivotThreads, make);
