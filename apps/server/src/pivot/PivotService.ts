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
import {
  type ModelSelection,
  PIVOT_HISTORY_DEFAULT_LIMIT,
  PIVOT_HISTORY_MAX_LIMIT,
  type PivotCreateResult,
  type PivotDecision,
  type PivotDecisionId,
  type PivotMcpAddIntentInput,
  type PivotMcpAnswerDecisionInput,
  type PivotMcpControlResult,
  type PivotMcpDecisionResult,
  type PivotMcpDispatchTeammateInput,
  type PivotMcpDispatchTeammateResult,
  type PivotMcpEscalateDecisionInput,
  type PivotMcpLandTeammateInput,
  type PivotMcpLandTeammateResult,
  type PivotMcpListTeammatesInput,
  type PivotMcpListTeammatesResult,
  type PivotMcpMarkDecisionMootInput,
  type PivotMcpMergeTeammateInput,
  type PivotMcpMergeTeammateResult,
  type PivotMcpOpenDecisionInput,
  type PivotMcpPromoteScoutInput,
  type PivotMcpRecordScoutReportInput,
  type PivotMcpRecordScoutReportResult,
  type PivotMcpReportStatusInput,
  type PivotMcpReportStatusResult,
  type PivotMcpTeammateHistoryInput,
  type PivotMcpTeammateHistoryResult,
  type PivotMcpTeammateLine,
  type PivotMcpTeammateResult,
  type PivotMcpTeammateTarget,
  type PivotMcpTeardownTeammateInput,
  type PivotMcpTeardownTeammateResult,
  type PivotStreamEvent,
  type PivotTeammateDetail,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { deriveTeammateStatus } from "@t3tools/shared/teammateStatus";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import {
  BRIEF_TEXTS,
  definitionOfDoneText,
  opensWithSpeakerLabel,
  renderBrief,
  renderPromotion,
  teammateBranchBase,
  uniqueBranch,
} from "./pivotBrief.ts";
import { mergeRefusals, PIVOT_MERGE_PROVIDERS } from "./pivotDelivery.ts";
import type { PivotEvent, StoredPivotEvent } from "./PivotEvents.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotHome from "./PivotHome.ts";
import * as PivotStore from "./PivotStore.ts";
import { loadPivotText, type PivotTextError } from "./pivotTexts.ts";
import * as PivotThreads from "./PivotThreads.ts";

/** The caller is not the active Pivot (for a Pivot tool) or a live teammate (for a teammate tool). */
export class PivotCallerError extends Schema.TaggedError<PivotCallerError>()("PivotCallerError", {
  tool: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export type PivotServiceError =
  | PivotCallerError
  | PivotStore.PivotRefusedError
  | PivotStore.PivotStoreError
  | PivotThreads.PivotThreadsError
  | PivotHome.PivotHomeError
  | PivotGit.PivotGitError
  | PivotTextError;

type Result<A> = Effect.Effect<A, PivotServiceError>;

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

    // The Pivot's tools. `caller` is the calling thread; only the active Pivot may call.

    /**
     * Launches a teammate in a fresh worktree on `pivot/<slug>`, full-access, with the
     * rendered brief as its first message from the Pivot, and returns once its first
     * run started or failed to.
     */
    readonly dispatchTeammate: (
      caller: ThreadId,
      input: PivotMcpDispatchTeammateInput,
    ) => Result<PivotMcpDispatchTeammateResult>;
    readonly promoteScout: (
      caller: ThreadId,
      input: PivotMcpPromoteScoutInput,
    ) => Result<PivotMcpTeammateResult>;
    /** Appends the user's words to the intent and sends them with the Pivot's text. */
    readonly addIntent: (
      caller: ThreadId,
      input: PivotMcpAddIntentInput,
    ) => Result<PivotMcpTeammateResult>;
    readonly openDecision: (
      caller: ThreadId,
      input: PivotMcpOpenDecisionInput,
    ) => Result<PivotMcpDecisionResult>;
    readonly escalateDecision: (
      caller: ThreadId,
      input: PivotMcpEscalateDecisionInput,
    ) => Result<PivotMcpDecisionResult>;
    /** Sends the answer to the decision's teammate, if it has one, then closes it. */
    readonly answerDecision: (
      caller: ThreadId,
      input: PivotMcpAnswerDecisionInput,
    ) => Result<PivotMcpDecisionResult>;
    readonly markDecisionMoot: (
      caller: ThreadId,
      input: PivotMcpMarkDecisionMootInput,
    ) => Result<PivotMcpDecisionResult>;
    readonly listTeammates: (
      caller: ThreadId,
      input: PivotMcpListTeammatesInput,
    ) => Result<PivotMcpListTeammatesResult>;
    readonly teammateHistory: (
      caller: ThreadId,
      input: PivotMcpTeammateHistoryInput,
    ) => Result<PivotMcpTeammateHistoryResult>;
    readonly stopTeammate: (
      caller: ThreadId,
      input: PivotMcpTeammateTarget,
    ) => Result<PivotMcpControlResult>;
    /**
     * Stops the session and resumes the conversation in a new one. A teammate whose
     * launch failed gets its launch retried in the worktree it recorded instead.
     */
    readonly relaunchTeammate: (
      caller: ThreadId,
      input: PivotMcpTeammateTarget,
    ) => Result<PivotMcpControlResult>;
    /**
     * Squash-merges a ship's PR on the user's recorded approval, after reading live
     * state: refuses a closed, draft or unmergeable PR and any check not green at the
     * current head unless the user waived it by name, and pins the merge to that head.
     * GitHub and GitLab only.
     */
    readonly mergeTeammate: (
      caller: ThreadId,
      input: PivotMcpMergeTeammateInput,
    ) => Result<PivotMcpMergeTeammateResult>;
    /** Fast-forwards the default branch to a local-only ship's branch, on approval. */
    readonly landTeammate: (
      caller: ThreadId,
      input: PivotMcpLandTeammateInput,
    ) => Result<PivotMcpLandTeammateResult>;
    /**
     * Removes a teammate whose work landed: stops its session and managed processes,
     * removes its worktree, archives its thread. The branch, history and open
     * decisions stay. Unlanded work needs a decision the user answered to discard it.
     */
    readonly teardownTeammate: (
      caller: ThreadId,
      input: PivotMcpTeardownTeammateInput,
    ) => Result<PivotMcpTeardownTeammateResult>;

    // A teammate's tools. Only a live teammate may call.

    readonly reportStatus: (
      caller: ThreadId,
      input: PivotMcpReportStatusInput,
    ) => Result<PivotMcpReportStatusResult>;
    readonly recordScoutReport: (
      caller: ThreadId,
      input: PivotMcpRecordScoutReportInput,
    ) => Result<PivotMcpRecordScoutReportResult>;
  }
>()("t3/pivot/PivotService") {}

const HISTORY_LINE_MAX = 500;
const clip = (text: string, max = HISTORY_LINE_MAX) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** One line of a teammate's history, as the Pivot reads it. */
export const historyLine = (event: PivotEvent): string => {
  switch (event.type) {
    case "teammate.dispatched":
      return `Dispatched as a ${event.kind} on ${event.branch} from ${event.baseBranch}.`;
    case "teammate.promoted":
      return "Promoted from scout to ship.";
    case "teammate.intent-added":
      return clip(`The user added: ${event.text}`);
    case "teammate.reported":
      return clip(`Reported ${event.report.status}: ${event.report.summary ?? ""}`);
    case "teammate.scout-report-recorded":
      // The report is the deliverable, so it reads in full.
      return `Recorded its scout report:\n${event.report}`;
    case "teammate.resume-changed":
      return event.resume === "pending"
        ? "Resuming after a server restart."
        : event.resume === "failed"
          ? "Did not survive the server restart."
          : "Resumed after the server restart.";
    case "teammate.status-observed":
      return clip(
        `Status ${event.previousStatus ?? "new"} → ${event.status}${event.detail ? `: ${event.detail}` : ""}`,
      );
    case "teammate.stopped":
      return "Stopped by the Pivot.";
    case "teammate.relaunched":
      return "Relaunched by the Pivot.";
    case "teammate.stuck":
      return "No activity for 30 minutes while running.";
    case "teammate.pause-rechecked":
      return "Its pause was due for a recheck.";
    case "teammate.user-message":
      return clip(`The user wrote to it directly: ${event.text}`);
    case "teammate.request-answered":
      return clip(`Its pending approval or question was answered: ${event.answer}`);
    case "teammate.delivery-changed":
      return event.change === "merged"
        ? `Its PR merged: ${event.url}`
        : event.change === "closed"
          ? `Its PR closed without merging: ${event.url}`
          : `Checks went red on its PR: ${event.url}`;
    case "teammate.merge-requested":
      return event.url === null
        ? "The Pivot's merge was refused by the forge."
        : `The Pivot merged its PR: ${event.url}`;
    case "teammate.landed":
      return `Landed by fast-forward at ${event.head.slice(0, 12)}.`;
    case "teammate.torn-down":
      return "Torn down.";
    case "decision.opened":
      return clip(`Decision "${event.key}" opened by the ${event.openedBy}: ${event.summary}`);
    case "decision.escalated":
      return clip(`Decision escalated to the user: ${event.escalation.questions.join(" / ")}`);
    case "decision.user-answered":
      return clip(`The user answered: ${event.answer}`);
    case "decision.closed":
      return clip(
        event.kind === "answered"
          ? `Decision answered by the Pivot: ${event.text}`
          : event.kind === "cleared"
            ? `Blocker cleared by the teammate: ${event.text}`
            : `Decision closed as moot (not the user's words): ${event.text}`,
      );
    case "pivot.created":
    case "pivot.retired":
    case "pivot.woke":
      return event.type;
  }
};

export const make = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  const threads = yield* PivotThreads.PivotThreads;
  const home = yield* PivotHome.PivotHome;
  const git = yield* PivotGit.PivotGit;
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

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

  // --- Callers ---

  const activePivot = (command: string, caller: ThreadId) =>
    Effect.gen(function* () {
      const pivot = yield* store.getPivot(caller);
      if (pivot === null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "Only a Pivot can use this tool.",
        });
      }
      if (pivot.retiredAt !== null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "This Pivot is retired; its successor holds the work now.",
        });
      }
      return pivot;
    });

  /**
   * The teammate with the worktree its thread recorded. Dispatch derived the path the
   * way V2 does; once V2 recorded one, that is the truth.
   */
  const withRecordedWorktree = (teammate: PivotStore.TeammateRow) =>
    threads.shell(teammate.threadId).pipe(
      Effect.map((shell) =>
        shell?.worktreePath == null || shell.worktreePath === teammate.worktreePath
          ? teammate
          : { ...teammate, worktreePath: shell.worktreePath },
      ),
      Effect.orElseSucceed(() => teammate),
    );

  /** A live teammate of the calling Pivot, refusing any other target. */
  const ownTeammate = (command: string, pivot: PivotStore.PivotRow, threadId: ThreadId) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(threadId);
      if (teammate === null || teammate.pivotThreadId !== pivot.threadId) {
        return yield* refuse(command, `Thread ${threadId} is not one of your teammates.`);
      }
      if (teammate.tornDownAt !== null) {
        return yield* refuse(command, `Teammate ${threadId} was torn down.`);
      }
      return yield* withRecordedWorktree(teammate);
    });

  const liveTeammate = (command: string, caller: ThreadId) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(caller);
      if (teammate === null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "Only a teammate can use this tool.",
        });
      }
      if (teammate.tornDownAt !== null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "This teammate was torn down.",
        });
      }
      return yield* withRecordedWorktree(teammate);
    });

  const nonEmpty = (command: string, text: string, what: string) =>
    text.trim().length === 0 ? Effect.fail(refuse(command, `${what} is empty.`)) : Effect.void;

  const text = (name: string) =>
    loadPivotText(name).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const decisionResult = (command: string, decisionId: PivotDecisionId) =>
    Effect.gen(function* () {
      const decision = yield* store.getDecision(decisionId);
      if (decision === null) return yield* refuse(command, `Decision ${decisionId} was not found.`);
      return { decision };
    });

  // --- Dispatch ---

  const dispatchTeammate: PivotService["Service"]["dispatchTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "dispatch_teammate";
      const pivot = yield* activePivot(command, caller);
      yield* nonEmpty(command, input.title, "The title");
      yield* nonEmpty(command, input.intent, "The intent");
      yield* nonEmpty(command, input.spec, "The spec");
      if (opensWithSpeakerLabel(input.intent)) {
        return yield* refuse(
          command,
          'The intent opens with a speaker label. Pass the user\'s words verbatim, without "User:" or an address.',
        );
      }
      return yield* withProjectLock(
        pivot.projectId,
        Effect.gen(function* () {
          const project = yield* gitProject(command, pivot.projectId);
          const deliveryMode = (yield* git.hasRemote(project.workspaceRoot))
            ? ("direct-pr" as const)
            : ("local-only" as const);
          const baseBranch = input.baseBranch ?? (yield* git.defaultBranch(project.workspaceRoot));
          const taken = new Set<string>(yield* git.listBranches(project.workspaceRoot, "pivot/"));
          for (const teammate of yield* store.listTeammates({ includeTornDown: true })) {
            if (teammate.projectId === pivot.projectId) taken.add(teammate.branch);
          }
          const repoName = path.basename(project.workspaceRoot);
          const worktreeFor = (branch: string) =>
            path.join(config.worktreesDir, repoName, branch.replace(/\//g, "-"));
          // A leftover directory would make `git worktree add` fail, so it counts as taken.
          const base = teammateBranchBase(input.title);
          let finalBranch = uniqueBranch(base, (candidate) => taken.has(candidate));
          while (
            yield* fs.exists(worktreeFor(finalBranch)).pipe(Effect.orElseSucceed(() => false))
          ) {
            taken.add(finalBranch);
            finalBranch = uniqueBranch(base, (candidate) => taken.has(candidate));
          }
          const worktreePath = worktreeFor(finalBranch);
          const brief = renderBrief(yield* text(BRIEF_TEXTS.brief), {
            title: input.title,
            kind: input.kind,
            intent: input.intent,
            spec: input.spec,
            branch: finalBranch,
            baseBranch,
            worktreePath,
            definitionOfDone: yield* text(definitionOfDoneText(input.kind, deliveryMode)),
          });
          const pivotShell = yield* threads.shell(pivot.threadId);
          const modelSelection =
            input.modelSelection ??
            project.defaultModelSelection ??
            pivotShell?.modelSelection ??
            null;
          if (modelSelection === null) {
            return yield* refuse(command, "No model to run the teammate on. Name one.");
          }
          const launched = yield* threads.launchTeammate({
            projectId: pivot.projectId,
            pivotThreadId: pivot.threadId,
            title: input.title,
            branch: finalBranch,
            baseBranch,
            modelSelection,
            text: brief,
          });
          // Recorded before the first run gets going, so its first report finds it.
          yield* store
            .dispatch({
              type: "teammate.dispatch",
              pivotThreadId: pivot.threadId,
              threadId: launched.threadId,
              projectId: pivot.projectId,
              kind: input.kind,
              title: input.title,
              branch: finalBranch,
              baseBranch,
              worktreePath: launched.runId === null ? null : worktreePath,
              deliveryMode,
              intent: input.intent,
              spec: input.spec,
            })
            .pipe(Effect.tapError(() => threads.archive(launched.threadId).pipe(Effect.ignore)));
          const start =
            launched.runId === null
              ? ({ type: "failed", runId: null, detail: "The launch created no run." } as const)
              : yield* threads.awaitStart(launched.threadId, launched.runId);
          return {
            threadId: launched.threadId,
            title: input.title,
            kind: input.kind,
            branch: finalBranch,
            baseBranch,
            worktreePath,
            deliveryMode,
            firstRun: start.type,
            detail: start.type === "failed" ? start.detail : null,
          };
        }),
      );
    });

  const promoteScout: PivotService["Service"]["promoteScout"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "promote_scout";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      if (teammate.kind !== "scout") return yield* refuse(command, "Only a scout can be promoted.");
      yield* nonEmpty(command, input.spec, "The spec");
      const message = renderPromotion(yield* text(BRIEF_TEXTS.promotion), {
        intent: teammate.intent.join("\n\n"),
        spec: input.spec,
        definitionOfDone: yield* text(definitionOfDoneText("ship", teammate.deliveryMode)),
      });
      yield* store.dispatch({
        type: "teammate.promote",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        spec: input.spec,
      });
      yield* threads.send({
        threadId: teammate.threadId,
        senderThreadId: pivot.threadId,
        text: message,
        mode: "queue",
      });
      return { threadId: teammate.threadId, kind: "ship" as const, intent: teammate.intent };
    });

  const addIntent: PivotService["Service"]["addIntent"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "add_intent";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      yield* nonEmpty(command, input.intent, "The user's words");
      if (opensWithSpeakerLabel(input.intent)) {
        return yield* refuse(command, "Pass the user's words verbatim, without a speaker label.");
      }
      yield* store.dispatch({
        type: "teammate.add-intent",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        text: input.intent,
      });
      const own = input.text?.trim() ?? "";
      yield* threads.send({
        threadId: teammate.threadId,
        senderThreadId: pivot.threadId,
        text: [
          "The user added to your task. Their words, which join the intent in your brief:",
          "",
          input.intent.trim(),
          ...(own.length > 0 ? ["", own] : []),
        ].join("\n"),
        mode: "queue",
      });
      return {
        threadId: teammate.threadId,
        kind: teammate.kind,
        intent: [...teammate.intent, input.intent],
      };
    });

  // --- Decisions ---

  const openDecision: PivotService["Service"]["openDecision"] = (caller, input) =>
    Effect.gen(function* () {
      const pivot = yield* activePivot("open_decision", caller);
      const [opened] = yield* store.dispatch({
        type: "decision.open",
        pivotThreadId: pivot.threadId,
        teammateThreadId: input.teammateThreadId ?? null,
        key: input.key ?? null,
        summary: input.question,
      });
      if (opened?.event.type !== "decision.opened") {
        return yield* refuse("open_decision", "The decision was not opened.");
      }
      return yield* decisionResult("open_decision", opened.event.decisionId);
    });

  const escalateDecision: PivotService["Service"]["escalateDecision"] = (caller, input) =>
    Effect.gen(function* () {
      const pivot = yield* activePivot("escalate_decision", caller);
      const { decisionId, ...escalation } = input;
      yield* store.dispatch({
        type: "decision.escalate",
        pivotThreadId: pivot.threadId,
        decisionId,
        escalation,
      });
      return yield* decisionResult("escalate_decision", decisionId);
    });

  const answerDecision: PivotService["Service"]["answerDecision"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "answer_decision";
      const pivot = yield* activePivot(command, caller);
      const decision = yield* store.getDecision(input.decisionId);
      if (decision === null || decision.pivotThreadId !== pivot.threadId) {
        return yield* refuse(command, `Decision ${input.decisionId} is not one of yours.`);
      }
      if (decision.resolution !== null) {
        return yield* refuse(command, `Decision ${input.decisionId} is already closed.`);
      }
      if (decision.escalatedAt !== null && decision.userAnswer === null) {
        return yield* refuse(
          command,
          "This decision is held for the user; relay their answer once they give it.",
        );
      }
      yield* nonEmpty(command, input.answer, "The answer");
      // The teammate hears the answer before the decision closes, so a failed send
      // leaves it open rather than closed and unheard.
      if (decision.teammateThreadId !== null) {
        const teammate = yield* store.getTeammate(decision.teammateThreadId);
        if (teammate !== null && teammate.tornDownAt === null) {
          yield* threads.send({
            threadId: decision.teammateThreadId,
            senderThreadId: pivot.threadId,
            text: input.answer,
            mode: "queue",
          });
        }
      }
      yield* store.dispatch({
        type: "decision.answer",
        pivotThreadId: pivot.threadId,
        decisionId: input.decisionId,
        text: input.answer,
      });
      return yield* decisionResult(command, input.decisionId);
    });

  const markDecisionMoot: PivotService["Service"]["markDecisionMoot"] = (caller, input) =>
    Effect.gen(function* () {
      const pivot = yield* activePivot("mark_decision_moot", caller);
      yield* store.dispatch({
        type: "decision.mark-moot",
        pivotThreadId: pivot.threadId,
        decisionId: input.decisionId,
        evidence: input.evidence,
      });
      return yield* decisionResult("mark_decision_moot", input.decisionId);
    });

  // --- Reads ---

  const teammateLine = (teammate: PivotStore.TeammateRow) =>
    Effect.gen(function* () {
      const shell = yield* threads.shell(teammate.threadId);
      const derived =
        shell === null
          ? { status: "unreported" as const, detail: null }
          : deriveTeammateStatus({
              status: shell.status,
              latestRunId: shell.latestRunId,
              pendingRuntimeRequest: shell.pendingRuntimeRequest,
              pendingBackgroundTasks: shell.pendingBackgroundTasks ?? [],
              lastError: shell.lastError ?? null,
              lastErrorClass: shell.lastErrorClass ?? null,
              teammate,
            });
      const [latest] = yield* store.teammateHistory({ threadId: teammate.threadId, limit: 1 });
      const pullRequest =
        shell?.pullRequests?.find((link) => link.source !== "stack-dismissed")?.url ??
        shell?.linkedPullRequest?.url ??
        null;
      return {
        threadId: teammate.threadId,
        title: teammate.title,
        kind: teammate.kind,
        status: derived.status,
        summary: derived.detail ?? teammate.report?.summary ?? null,
        branch: teammate.branch,
        pullRequestUrl: pullRequest,
        lastChangeAt: latest?.occurredAt ?? null,
        worktreePath: teammate.worktreePath,
        tornDown: teammate.tornDownAt !== null,
      } satisfies PivotMcpTeammateLine;
    });

  const listTeammates: PivotService["Service"]["listTeammates"] = (caller, input) =>
    Effect.gen(function* () {
      const pivot = yield* activePivot("list_teammates", caller);
      const teammates = yield* store.listTeammates({
        pivotThreadId: pivot.threadId,
        includeTornDown: input.includeTornDown ?? false,
      });
      return { teammates: yield* Effect.forEach(teammates, teammateLine) };
    });

  const teammateHistory: PivotService["Service"]["teammateHistory"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "teammate_history";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* store.getTeammate(input.threadId);
      // Torn-down teammates stay readable; only another Pivot's are out of scope.
      if (teammate === null || teammate.pivotThreadId !== pivot.threadId) {
        return yield* refuse(command, `Thread ${input.threadId} is not one of your teammates.`);
      }
      const limit = Math.min(input.limit ?? PIVOT_HISTORY_DEFAULT_LIMIT, PIVOT_HISTORY_MAX_LIMIT);
      const events: ReadonlyArray<StoredPivotEvent> = yield* store.teammateHistory({
        threadId: input.threadId,
        ...(input.beforeSequence === undefined ? {} : { beforeSequence: input.beforeSequence }),
        limit: limit + 1,
      });
      const page = events.slice(0, limit);
      return {
        entries: page.map((stored) => ({
          sequence: stored.sequence,
          at: stored.occurredAt,
          line: historyLine(stored.event),
        })),
        nextBeforeSequence: events.length > limit ? (page.at(-1)?.sequence ?? null) : null,
      };
    });

  // --- Control ---

  const stopTeammate: PivotService["Service"]["stopTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "stop_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      const shell = yield* threads.shell(teammate.threadId);
      // Recorded first, so what the stopped run does next is the Pivot's own doing.
      yield* store.dispatch({
        type: "teammate.stop",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        runId: shell?.latestRunId ?? null,
      });
      yield* threads.stop(teammate.threadId);
      return { threadId: teammate.threadId, outcome: "stopped" as const, detail: null };
    });

  const relaunchTeammate: PivotService["Service"]["relaunchTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "relaunch_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      const shell = yield* threads.shell(teammate.threadId);
      yield* store.dispatch({
        type: "teammate.stop",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        runId: shell?.latestRunId ?? null,
      });
      yield* store.dispatch({
        type: "teammate.relaunch",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
      });
      // A launch whose setup failed never started its run; retry it in its worktree.
      const launchFailed =
        shell !== null &&
        shell.status === "failed" &&
        (shell.latestRunStartedAt === null || shell.latestRunStartedAt === undefined);
      const start = launchFailed
        ? yield* threads.retryLaunch(teammate.threadId)
        : yield* threads.relaunch({
            threadId: teammate.threadId,
            senderThreadId: pivot.threadId,
            text: "The Pivot restarted your session. Check your worktree and branch state, then carry on with the task from where it stands.",
          });
      return {
        threadId: teammate.threadId,
        outcome: start.type === "started" ? ("relaunched" as const) : ("relaunch-failed" as const),
        detail: start.type === "failed" ? start.detail : null,
      };
    });

  // --- Delivery ---

  /** A decision about this teammate that the user answered: their recorded word. */
  /** The Pivot's decision about this teammate. */
  const teammateDecision = (
    command: string,
    pivot: PivotStore.PivotRow,
    teammate: PivotStore.TeammateRow,
    decisionId: PivotDecisionId,
  ) =>
    Effect.gen(function* () {
      const decision = yield* store.getDecision(decisionId);
      if (
        decision === null ||
        decision.pivotThreadId !== pivot.threadId ||
        decision.teammateThreadId !== teammate.threadId
      ) {
        return yield* refuse(command, `Decision ${decisionId} is not about this teammate.`);
      }
      return decision;
    });

  const unanswered = (what: string) =>
    `${what} needs the user's recorded word: escalate the decision and wait for their answer.`;

  /**
   * A decision about this teammate the user answered: their recorded word. What the
   * answer says is the Pivot's to read; the tool holds it to there being one.
   */
  const userApproval = (
    command: string,
    pivot: PivotStore.PivotRow,
    teammate: PivotStore.TeammateRow,
    decisionId: PivotDecisionId,
    what: string,
  ) =>
    Effect.gen(function* () {
      const decision = yield* teammateDecision(command, pivot, teammate, decisionId);
      if (decision.userAnswer === null) return yield* refuse(command, unanswered(what));
      return decision;
    });

  const linkedPullRequest = (teammate: PivotStore.TeammateRow) =>
    Effect.gen(function* () {
      const shell = yield* threads.shell(teammate.threadId);
      const links = (shell?.pullRequests ?? []).filter((link) => link.source !== "stack-dismissed");
      return (
        links.find((link) => link.snapshot?.headBranch === teammate.branch) ?? links[0] ?? null
      );
    });

  const mergeTeammate: PivotService["Service"]["mergeTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "merge_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      if (teammate.kind !== "ship") return yield* refuse(command, "Only a ship's work merges.");
      if (teammate.deliveryMode !== "direct-pr") {
        return yield* refuse(
          command,
          "This project has no remote; land the branch with land_teammate.",
        );
      }
      const decision = yield* teammateDecision(command, pivot, teammate, input.decisionId);
      const link = yield* linkedPullRequest(teammate);
      if (link === null) return yield* refuse(command, "The teammate has no linked PR.");
      const ref = {
        projectId: teammate.projectId,
        host: link.host,
        repository: link.repository,
        number: link.number,
      };
      const detail = yield* threads.pullRequestDetail(ref);
      if (!PIVOT_MERGE_PROVIDERS.has(detail.provider)) {
        return yield* refuse(
          command,
          `The Pivot merges on GitHub and GitLab only. Ask the user to merge ${link.url} on ${detail.provider} by hand.`,
        );
      }
      const waived = input.waivedChecks ?? [];
      // Every failing condition at once: the approval, each waiver, and live state.
      const reasons = [
        ...(decision.userAnswer === null ? [unanswered("Merging")] : []),
        ...waived.flatMap((name) =>
          decision.userAnswer !== null && decision.userAnswer.includes(name)
            ? []
            : [`The user's answer does not waive check "${name}" by name.`],
        ),
        ...mergeRefusals(detail, waived),
      ];
      if (reasons.length > 0) {
        return yield* refuse(command, `Not merging ${link.url}:\n- ${reasons.join("\n- ")}`);
      }
      const head = detail.headSha!;
      // Recorded first, so the merge V2's sync then reports reads as the Pivot's own;
      // cleared again if the forge refuses, so a later merge by hand still wakes it.
      const recordMerge = (url: string | null) =>
        store.dispatch({
          type: "teammate.record-merge",
          pivotThreadId: pivot.threadId,
          threadId: teammate.threadId,
          url,
        });
      yield* recordMerge(link.url);
      yield* threads
        .mergePullRequest({ ...ref, expectedHeadSha: head })
        .pipe(Effect.tapError(() => recordMerge(null).pipe(Effect.ignore)));
      return { threadId: teammate.threadId, url: link.url, mergedHead: head };
    });

  const landTeammate: PivotService["Service"]["landTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "land_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      if (teammate.kind !== "ship") return yield* refuse(command, "Only a ship's work lands.");
      if (teammate.deliveryMode !== "local-only") {
        return yield* refuse(command, "This project delivers PRs; merge with merge_teammate.");
      }
      yield* userApproval(command, pivot, teammate, input.decisionId, "Landing");
      const project = yield* gitProject(command, pivot.projectId);
      if (!(yield* git.isClean(teammate.worktreePath))) {
        return yield* refuse(
          command,
          "The teammate's worktree has uncommitted changes; it commits them first.",
        );
      }
      const defaultBranch = yield* git.defaultBranch(project.workspaceRoot);
      const result = yield* git.fastForward({
        projectRoot: project.workspaceRoot,
        branch: teammate.branch,
        defaultBranch,
      });
      if (!result.landed) return yield* refuse(command, result.reason);
      yield* store.dispatch({
        type: "teammate.record-landing",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        head: result.head,
      });
      return {
        threadId: teammate.threadId,
        branch: teammate.branch,
        defaultBranch,
        landedHead: result.head,
      };
    });

  const teardownTeammate: PivotService["Service"]["teardownTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "teardown_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      const project = yield* gitProject(command, pivot.projectId);
      const worktreeExists = yield* fs
        .exists(teammate.worktreePath)
        .pipe(Effect.orElseSucceed(() => false));

      let reason: string;
      if (teammate.kind === "scout" && teammate.scoutReport !== null) {
        reason = "Its scout report is recorded.";
      } else {
        const link = yield* linkedPullRequest(teammate);
        let mergedHead: string | null = null;
        if (link?.snapshot?.state === "merged") {
          const detail = yield* threads
            .pullRequestDetail({
              projectId: teammate.projectId,
              host: link.host,
              repository: link.repository,
              number: link.number,
            })
            .pipe(Effect.orElseSucceed(() => null));
          mergedHead = detail?.state === "merged" ? (detail.headSha ?? null) : null;
        }
        const verdict = yield* git.landed({
          projectRoot: project.workspaceRoot,
          worktreePath: teammate.worktreePath,
          branch: teammate.branch,
          defaultBranch: yield* git.defaultBranch(project.workspaceRoot),
          mergedPullRequestHead: mergedHead,
        });
        if (verdict.landed) {
          reason = verdict.reason;
        } else if (input.discardDecisionId !== undefined) {
          yield* userApproval(command, pivot, teammate, input.discardDecisionId, "Discarding work");
          reason = `Discarded on the user's word: ${verdict.reason}`;
        } else {
          return yield* refuse(
            command,
            `Not torn down, its work has not landed. ${verdict.reason}`,
          );
        }
      }
      const discarding = reason.startsWith("Discarded");

      // The session goes first; if it will not stop, nothing else is touched.
      yield* threads.stop(teammate.threadId);
      yield* threads.stopProcesses(teammate.worktreePath);
      if (worktreeExists) {
        yield* threads.removeWorktree({
          projectRoot: project.workspaceRoot,
          worktreePath: teammate.worktreePath,
          force: discarding || teammate.kind === "scout",
        });
      }
      yield* threads.archive(teammate.threadId);
      yield* store.dispatch({
        type: "teammate.tear-down",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
      });
      return { threadId: teammate.threadId, reason, branch: teammate.branch };
    });

  // --- Teammate tools ---

  const reportStatus: PivotService["Service"]["reportStatus"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "report_status";
      const teammate = yield* liveTeammate(command, caller);
      const shell = yield* threads.shell(teammate.threadId);
      if (
        input.status === "done" &&
        teammate.kind === "ship" &&
        teammate.deliveryMode === "direct-pr"
      ) {
        const link = shell?.pullRequests?.find(
          (candidate) => candidate.source !== "stack-dismissed",
        );
        const url = link?.url ?? shell?.linkedPullRequest?.url ?? null;
        if (url === null) {
          return yield* refuse(
            command,
            "`done` needs a linked PR. Open it, link it with link_pull_request using the full URL, then report again.",
          );
        }
        if (link?.snapshot != null && link.snapshot.headBranch !== teammate.branch) {
          return yield* refuse(
            command,
            `The linked PR's head is ${link.snapshot.headBranch}, not your branch ${teammate.branch}.`,
          );
        }
        const local = yield* git.headCommit(teammate.worktreePath);
        const remote = yield* git.remoteBranchCommit(teammate.worktreePath, teammate.branch);
        if (remote !== local) {
          return yield* refuse(
            command,
            remote === null
              ? `Your branch ${teammate.branch} is not pushed. Push it, then report again.`
              : `Your latest commit ${local.slice(0, 12)} is not what origin has (${remote.slice(0, 12)}). Push, then report again.`,
          );
        }
      }
      yield* store.dispatch({
        type: "teammate.report",
        threadId: teammate.threadId,
        status: input.status,
        summary: input.summary,
        until: input.until ?? null,
        runId: shell?.latestRunId ?? null,
        decisionKey: input.decisionKey ?? null,
        clearedDecision:
          input.clearDecision === undefined
            ? null
            : { key: input.clearDecision.key ?? null, resolution: input.clearDecision.resolution },
      });
      const decisions = yield* store.listDecisions({
        pivotThreadId: teammate.pivotThreadId,
        openOnly: true,
      });
      return {
        status: input.status,
        openDecisions: decisions.filter((d) => d.teammateThreadId === teammate.threadId).length,
      };
    });

  const recordScoutReport: PivotService["Service"]["recordScoutReport"] = (caller, input) =>
    Effect.gen(function* () {
      const teammate = yield* liveTeammate("record_scout_report", caller);
      yield* store.dispatch({
        type: "teammate.record-scout-report",
        threadId: teammate.threadId,
        report: input.report,
      });
      return { recorded: true };
    });

  return PivotService.of({
    create,
    stream: store.stream,
    teammateDetail,
    recordUserAnswer,
    dispatchTeammate,
    promoteScout,
    addIntent,
    openDecision,
    escalateDecision,
    answerDecision,
    markDecisionMoot,
    listTeammates,
    teammateHistory,
    stopTeammate,
    relaunchTeammate,
    mergeTeammate,
    landTeammate,
    teardownTeammate,
    reportStatus,
    recordScoutReport,
  });
});

export const layer = Layer.effect(PivotService, make);
