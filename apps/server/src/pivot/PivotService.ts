/**
 * PivotService - Pivot mode's capabilities: creating a Pivot, everything a Pivot
 * does to its teammates, everything a teammate reports, and the user's answers.
 *
 * Transports stay thin: the WebSocket handlers, the Pivot and teammate MCP
 * toolkits and the supervisor all call these methods. Records go to the Pivot
 * store; V2 threads are reached through PivotThreads.
 *
 * @module PivotService
 */
import type {
  ModelSelection,
  PivotCreateResult,
  PivotDecision,
  PivotDecisionId,
  PivotStreamEvent,
  PivotTeammateDetail,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as PivotGit from "./PivotGit.ts";
import * as PivotHome from "./PivotHome.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotThreads from "./PivotThreads.ts";

export type PivotServiceError =
  | PivotStore.PivotRefusedError
  | PivotStore.PivotStoreError
  | PivotThreads.PivotThreadsError
  | PivotHome.PivotHomeError
  | PivotGit.PivotGitError;

export class PivotService extends Context.Service<
  PivotService,
  {
    /**
     * Creates a Pivot in the project's Pivot home. With `takeover`, an active Pivot
     * hands over its live teammates, open decisions and pending wakes and retires;
     * without it, a project with an active Pivot refuses.
     */
    readonly create: (input: {
      readonly projectId: ProjectId;
      readonly modelSelection: ModelSelection;
      readonly takeover: boolean;
    }) => Effect.Effect<PivotCreateResult, PivotServiceError>;
    readonly stream: Stream.Stream<PivotStreamEvent, PivotServiceError>;
    /** A teammate's brief and scout report, which never ride the stream. */
    readonly teammateDetail: (
      threadId: ThreadId,
    ) => Effect.Effect<PivotTeammateDetail, PivotServiceError>;
    /** Records the user's answer to an escalated decision, verbatim, and wakes the Pivot. */
    readonly recordUserAnswer: (input: {
      readonly decisionId: PivotDecisionId;
      readonly answer: string;
    }) => Effect.Effect<PivotDecision, PivotServiceError>;
  }
>()("t3/pivot/PivotService") {}

export const make = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  const threads = yield* PivotThreads.PivotThreads;
  const home = yield* PivotHome.PivotHome;
  const git = yield* PivotGit.PivotGit;

  // Creating a Pivot or a teammate spans two databases; one at a time per project.
  const projectLocks = new Map<string, Semaphore.Semaphore>();
  const withProjectLock = <A, E, R>(projectId: ProjectId, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      let lock = projectLocks.get(projectId);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        projectLocks.set(projectId, lock);
      }
      return lock.withPermits(1)(effect);
    });

  const refuse = (command: string, reason: string) =>
    new PivotStore.PivotRefusedError({ command, reason });

  /** The project, refusing one that is gone or not a git repository. */
  const gitProject = (command: string, projectId: ProjectId) =>
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

  const create: PivotService["Service"]["create"] = (input) =>
    withProjectLock(
      input.projectId,
      Effect.gen(function* () {
        yield* gitProject("pivot.create", input.projectId);
        const active = yield* store.getActivePivot(input.projectId);
        if (active !== null && !input.takeover) {
          return yield* refuse(
            "pivot.create",
            "This project already has an active Pivot. Creating another takes over its work.",
          );
        }
        const homePath = yield* home.ensure(input.projectId);
        const threadId = yield* threads.createPivotThread({
          projectId: input.projectId,
          homePath,
          modelSelection: input.modelSelection,
        });
        // No Pivot thread exists without its record.
        yield* store
          .dispatch({
            type: "pivot.create",
            threadId,
            projectId: input.projectId,
            homePath,
            takeover: input.takeover,
          })
          .pipe(Effect.tapError(() => threads.archive(threadId).pipe(Effect.ignore)));
        return { threadId, predecessorThreadId: active?.threadId ?? null };
      }),
    );

  const teammateDetail: PivotService["Service"]["teammateDetail"] = (threadId) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(threadId);
      if (teammate === null) {
        return yield* refuse("teammate.detail", `Thread ${threadId} is not a teammate.`);
      }
      return {
        teammate: PivotStore.teammateRecord(teammate),
        intent: teammate.intent,
        spec: teammate.spec,
        baseBranch: teammate.baseBranch,
        worktreePath: teammate.worktreePath,
        deliveryMode: teammate.deliveryMode,
        scoutReport: teammate.scoutReport,
      };
    });

  const recordUserAnswer: PivotService["Service"]["recordUserAnswer"] = ({ decisionId, answer }) =>
    Effect.gen(function* () {
      yield* store.dispatch({ type: "decision.record-user-answer", decisionId, answer });
      const decision = yield* store.getDecision(decisionId);
      if (decision === null) {
        return yield* refuse(
          "decision.record-user-answer",
          `Decision ${decisionId} was not found.`,
        );
      }
      return decision;
    });

  return PivotService.of({ create, stream: store.stream, teammateDetail, recordUserAnswer });
});

export const layer = Layer.effect(PivotService, make);
