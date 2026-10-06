/**
 * An in-memory V2 for Pivot mode's tests: threads, the messages sent into them,
 * and the outcome of a teammate's first run.
 */
import {
  type ModelSelection,
  type PullRequestDetail,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  PivotThreads,
  PivotThreadsError,
  type PivotProject,
  type RunStart,
} from "./PivotThreads.ts";

export interface FakeMessage {
  readonly senderThreadId: ThreadId | null;
  readonly text: string;
  readonly mode: "launch" | "auto" | "queue" | "relaunch";
}

export interface FakeThread {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly kind: "pivot" | "teammate";
  worktreePath: string | null;
  branch: string | null;
  baseBranch: string | null;
  title: string;
  modelSelection: ModelSelection;
  archived: boolean;
  stops: number;
  relaunches: number;
  readonly messages: Array<FakeMessage>;
  shell: Partial<OrchestrationV2ThreadShell>;
}

export interface FakeV2 {
  readonly projects: Map<string, PivotProject>;
  readonly threads: Map<string, FakeThread>;
  /** How the next teammate launch comes out. Defaults to a started run in a fresh worktree. */
  nextLaunch: { readonly worktreePath: string | null; readonly start: RunStart } | null;
  /** First-run outcomes by thread, read by awaitStart. */
  readonly starts: Map<string, RunStart>;
  /** How the next relaunch comes out. */
  nextRelaunch: RunStart | null;
  failPivotThreadCreate: boolean;
  failSend: boolean;
  /** The id the next created thread gets. */
  nextThreadId: ThreadId | null;
  /** Wakes posted on Pivot threads, oldest first; a joined wake replaces the queued one. */
  readonly wakes: Array<FakeWake>;
  /** Pivot threads whose last wake is still queued, so the next one joins it. */
  readonly queuedWakes: Set<string>;
  /** Live PR state by URL, as the forge would report it. */
  readonly pullRequests: Map<string, Partial<PullRequestDetail>>;
  /** Merges asked of the forge, with the head they were pinned to. */
  readonly merges: Array<{ readonly url: string; readonly expectedHeadSha: string }>;
  readonly stoppedCheckouts: Array<string>;
  /** Threads whose held queue was released. */
  readonly releasedQueues: Array<string>;
  readonly removedWorktrees: Array<{ readonly worktreePath: string; readonly force: boolean }>;
}

export interface FakeWake {
  readonly pivotThreadId: ThreadId;
  readonly messageId: string;
  readonly text: string;
  readonly summary: string;
  readonly teammateThreadIds: ReadonlyArray<ThreadId>;
}

export const makeFakeV2 = (): FakeV2 => ({
  projects: new Map(),
  threads: new Map(),
  nextLaunch: null,
  starts: new Map(),
  nextRelaunch: null,
  failPivotThreadCreate: false,
  failSend: false,
  nextThreadId: null,
  wakes: [],
  queuedWakes: new Set(),
  pullRequests: new Map(),
  merges: [],
  stoppedCheckouts: [],
  releasedQueues: [],
  removedWorktrees: [],
});

let counter = 0;
const allocate = (fake: FakeV2, prefix: string) => {
  const id = fake.nextThreadId ?? ThreadId.make(`${prefix}-${++counter}`);
  fake.nextThreadId = null;
  return id;
};

const thread = (fake: FakeV2, threadId: ThreadId, operation: string) =>
  Effect.suspend(() => {
    const found = fake.threads.get(threadId);
    return found === undefined
      ? Effect.fail(new PivotThreadsError({ operation, threadId }))
      : Effect.succeed(found);
  });

export const fakeShell = (found: FakeThread): OrchestrationV2ThreadShell =>
  ({
    id: found.threadId,
    projectId: found.projectId,
    title: found.title,
    modelSelection: found.modelSelection,
    branch: found.branch,
    worktreePath: found.worktreePath,
    archivedAt: found.archived ? "2026-10-06T00:00:00.000Z" : null,
    status: "idle",
    latestRunId: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    lastError: null,
    lastErrorClass: null,
    usageLimitResetAt: null,
    ...found.shell,
  }) as unknown as OrchestrationV2ThreadShell;

export const layer = (fake: FakeV2) =>
  Layer.succeed(
    PivotThreads,
    PivotThreads.of({
      project: (projectId) => Effect.sync(() => fake.projects.get(projectId) ?? null),
      createPivotThread: ({ projectId, homePath, modelSelection }) =>
        Effect.suspend(() => {
          if (fake.failPivotThreadCreate) {
            return Effect.fail(
              new PivotThreadsError({
                operation: "create the Pivot thread",
              }),
            );
          }
          const threadId = allocate(fake, "pivot");
          fake.threads.set(threadId, {
            threadId,
            projectId,
            kind: "pivot",
            worktreePath: homePath,
            branch: null,
            baseBranch: null,
            title: "Pivot",
            modelSelection,
            archived: false,
            stops: 0,
            relaunches: 0,
            messages: [],
            shell: {},
          });
          return Effect.succeed(threadId);
        }),
      launchTeammate: (input) =>
        Effect.sync(() => {
          const threadId = allocate(fake, "teammate");
          const outcome = fake.nextLaunch ?? {
            worktreePath: null,
            start: { type: "started", runId: RunId.make(`run-${threadId}`) } as RunStart,
          };
          fake.nextLaunch = null;
          fake.threads.set(threadId, {
            threadId,
            projectId: input.projectId,
            kind: "teammate",
            worktreePath: outcome.worktreePath,
            branch: input.branch,
            baseBranch: input.baseBranch,
            title: input.title,
            modelSelection: input.modelSelection,
            archived: false,
            stops: 0,
            relaunches: 0,
            messages: [{ senderThreadId: input.pivotThreadId, text: input.text, mode: "launch" }],
            shell: { latestRunId: outcome.start.runId },
          });
          fake.starts.set(threadId, outcome.start);
          return { threadId, runId: outcome.start.runId };
        }),
      awaitStart: (threadId) =>
        Effect.sync(
          (): RunStart =>
            fake.starts.get(threadId) ?? { type: "failed", runId: null, detail: "No run." },
        ),
      retryLaunch: (threadId) =>
        Effect.map(thread(fake, threadId, "retry"), (found): RunStart => {
          const outcome = fake.nextRelaunch ?? {
            type: "started",
            runId: RunId.make(`run-retry-${threadId}`),
          };
          fake.nextRelaunch = null;
          found.relaunches += 1;
          return outcome;
        }),
      archive: (threadId) =>
        Effect.map(thread(fake, threadId, "archive"), (found) => {
          found.archived = true;
        }),
      send: ({ threadId, senderThreadId, text, mode }) =>
        Effect.flatMap(thread(fake, threadId, "send"), (found) =>
          fake.failSend
            ? Effect.fail(new PivotThreadsError({ operation: "send", threadId }))
            : Effect.sync(() => {
                found.messages.push({ senderThreadId, text, mode });
              }),
        ),
      stop: (threadId) =>
        Effect.map(thread(fake, threadId, "stop"), (found) => {
          found.stops += 1;
        }),
      relaunch: ({ threadId, senderThreadId, text }) =>
        Effect.map(thread(fake, threadId, "relaunch"), (found): RunStart => {
          found.relaunches += 1;
          found.messages.push({ senderThreadId, text, mode: "relaunch" });
          const outcome = fake.nextRelaunch ?? {
            type: "started",
            runId: RunId.make(`run-relaunch-${found.relaunches}`),
          };
          fake.nextRelaunch = null;
          return outcome;
        }),
      shell: (threadId) =>
        Effect.sync(() => {
          const found = fake.threads.get(threadId);
          return found === undefined ? null : fakeShell(found);
        }),
      events: Stream.never,
      wake: (input) =>
        Effect.sync(() => {
          const wake = { ...input, messageId: String(input.messageId) };
          const queued = fake.queuedWakes.has(input.pivotThreadId);
          const index = fake.wakes.findLastIndex((w) => w.pivotThreadId === input.pivotThreadId);
          if (queued && index >= 0) fake.wakes[index] = wake;
          else fake.wakes.push(wake);
        }),
      releaseHeldQueue: (threadId) =>
        Effect.sync(() => {
          fake.releasedQueues.push(threadId);
        }),
      hasQueuedWake: (pivotThreadId) => Effect.sync(() => fake.queuedWakes.has(pivotThreadId)),
      pullRequestDetail: (ref) =>
        Effect.suspend(() => {
          const url = `https://${ref.host ?? "github.com"}/${ref.repository}/pull/${ref.number}`;
          const detail = fake.pullRequests.get(url);
          return detail === undefined
            ? Effect.fail(new PivotThreadsError({ operation: "read the PR" }))
            : Effect.succeed({ url, checks: [], ...detail } as PullRequestDetail);
        }),
      mergePullRequest: ({ expectedHeadSha, ...ref }) =>
        Effect.suspend(() => {
          const url = `https://${ref.host ?? "github.com"}/${ref.repository}/pull/${ref.number}`;
          const detail = fake.pullRequests.get(url);
          if (detail?.headSha !== expectedHeadSha) {
            return Effect.fail(
              new PivotThreadsError({
                operation: "merge the PR",
              }),
            );
          }
          fake.merges.push({ url, expectedHeadSha });
          fake.pullRequests.set(url, { ...detail, state: "merged" });
          return Effect.void;
        }),
      stopProcesses: (worktreePath) =>
        Effect.sync(() => {
          fake.stoppedCheckouts.push(worktreePath);
        }),
      removeWorktree: ({ worktreePath, force }) =>
        Effect.sync(() => {
          fake.removedWorktrees.push({ worktreePath, force });
        }),
    }),
  );
