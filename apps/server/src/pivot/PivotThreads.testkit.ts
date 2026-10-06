/**
 * An in-memory V2 for Pivot mode's tests: threads, the messages sent into them,
 * and the outcome of a teammate's first run.
 */
import {
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
      ? Effect.fail(
          new PivotThreadsError({ operation, threadId, detail: `Thread ${threadId} not found.` }),
        )
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
                detail: "V2 is down.",
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
            worktreePath: `/worktrees/${input.branch.replaceAll("/", "-")}`,
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
            ? Effect.fail(
                new PivotThreadsError({ operation: "send", threadId, detail: "Send failed." }),
              )
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
    }),
  );
