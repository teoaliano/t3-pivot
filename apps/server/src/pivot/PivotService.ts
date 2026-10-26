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
  type ChatImageAttachment,
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
  type ServerSettingsError,
  type ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { deriveTeammateStatus } from "@t3tools/shared/teammateStatus";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { defaultPivotTeammateCap } from "../process/agentScope.ts";
import {
  BRIEF_TEXTS,
  definitionOfDoneText,
  opensWithSpeakerLabel,
  renderPromotion,
} from "./pivotBrief.ts";
import { mergeRefusals, PIVOT_MERGE_PROVIDERS } from "./pivotDelivery.ts";
import type { PivotEvent, StoredPivotEvent } from "./PivotEvents.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotHome from "./PivotHome.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import * as PivotStore from "./PivotStore.ts";
import { chooseTeammateModel, renderTeammateModels } from "./pivotTeammateModels.ts";
import { loadPivotText, type PivotTextError } from "./pivotTexts.ts";
import * as PivotThreads from "./PivotThreads.ts";
import * as LocalTeammateHost from "./LocalTeammateHost.ts";
import { TeammateHost } from "./TeammateHost.ts";

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
  | PivotTextError
  | ServerSettingsError;

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
      readonly threadId?: ThreadId | undefined;
    }) => Effect.Effect<PivotCreateResult, PivotServiceError>;
    /**
     * Rewrites every active Pivot's home contract to this release's, leaving
     * `preferences.md` alone. Runs at server start, so an update reaches existing Pivots,
     * and when teammate models change in Settings.
     * A home that fails is logged and skipped.
     */
    readonly refreshHomes: Effect.Effect<void>;
    readonly stream: Stream.Stream<PivotStreamEvent, PivotServiceError>;
    /** A teammate's brief and scout report, which never ride the stream. */
    readonly teammateDetail: (
      threadId: ThreadId,
    ) => Effect.Effect<PivotTeammateDetail, PivotServiceError>;
    /** Every decision the Pivot owns, newest first, open and closed. */
    readonly decisionLog: (
      pivotThreadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<PivotDecision>, PivotServiceError>;
    /**
     * Records the user's answer to an escalated decision, verbatim, with any images, and
     * wakes the Pivot.
     */
    readonly recordUserAnswer: (input: {
      readonly decisionId: PivotDecisionId;
      readonly answer: string;
      /** Required for a decision that asks for approval. */
      readonly approved?: boolean | undefined;
      readonly attachments?: ReadonlyArray<ChatImageAttachment> | undefined;
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
      return `Dispatched as a ${event.kind} on ${event.branch} from ${event.baseBranch}${event.modelEntry ? `, on teammate model ${event.modelEntry}` : ""}.`;
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
    case "teammate.memory-wait-changed":
      return event.status === null ? "Stopped waiting for memory." : clip(event.status);
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
    case "teammate.pull-requests-seen":
      return event.pullRequests.length === 0
        ? "No PRs linked."
        : `PRs: ${event.pullRequests
            .map((pr) => `${pr.url} ${pr.state}${pr.checksFailing ? ", checks failing" : ""}`)
            .join("; ")}`;
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
    // The user's words are the deliverable, so they read in full.
    case "decision.user-answered":
      return `The user answered: ${event.answer}`;
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
  const hostStore = yield* PivotHostStore.PivotHostStore;
  const threads = yield* PivotThreads.PivotThreads;
  const home = yield* PivotHome.PivotHome;
  const git = yield* PivotGit.PivotGit;
  const localHost = yield* TeammateHost;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // Creating a Pivot or a teammate spans two databases; one at a time per project, under the
  // same lock a launch for another environment's Pivot takes.
  const withProjectLock = localHost.withProjectLock;

  /** The project's teammate models: its own list when it overrides one, else the environment's. */
  const teammateModels = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map((settings) => resolveProjectSettings(settings, projectId).settings.teammateModels),
    );

  /** The project's model per built-in teammate kind, from the same settings as the list. */
  // The most ships and scouts a Pivot runs at once: the setting, else on Linux what the
  // agents' memory limit holds at about 3 GB a teammate, else no cap.
  const teammateCap = Effect.gen(function* () {
    const setting = (yield* serverSettings.getSettings).pivotMaxTeammates;
    return setting ?? (yield* defaultPivotTeammateCap);
  });

  const teammateKindModels = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map(
        (settings) =>
          resolveProjectSettings(settings, projectId).settings.teammateKindModelSelections,
      ),
    );

  const ensureHome = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const entries = yield* teammateModels(projectId);
      return yield* home.ensure(projectId, renderTeammateModels(entries));
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
        const homePath = yield* ensureHome(input.projectId);
        const threadId = yield* threads.createPivotThread({
          projectId: input.projectId,
          homePath,
          modelSelection: input.modelSelection,
          threadId: input.threadId,
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
        // A retired Pivot's work moved to its successor, so it leaves the inbox.
        if (active !== null) {
          yield* threads.settle(active.threadId).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Retired Pivot did not settle", {
                threadId: active.threadId,
                cause,
              }),
            ),
          );
        }
        return { threadId, predecessorThreadId: active?.threadId ?? null };
      }),
    );

  const refreshHomes: PivotService["Service"]["refreshHomes"] = Effect.gen(function* () {
    const active = yield* store.listActivePivots;
    for (const pivot of active) {
      yield* ensureHome(pivot.projectId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Pivot home refresh failed", { projectId: pivot.projectId, cause }),
        ),
      );
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("Pivot home refresh failed", { cause })));

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

  const decisionLog: PivotService["Service"]["decisionLog"] = (pivotThreadId) =>
    Effect.gen(function* () {
      if ((yield* store.getPivot(pivotThreadId)) === null) {
        return yield* refuse("decision.log", `Thread ${pivotThreadId} is not a Pivot.`);
      }
      const decisions = yield* store.listDecisions({ pivotThreadId, openOnly: false });
      return decisions.toReversed();
    });

  const recordUserAnswer: PivotService["Service"]["recordUserAnswer"] = ({
    decisionId,
    answer,
    approved,
    attachments,
  }) =>
    Effect.gen(function* () {
      yield* store.dispatch({
        type: "decision.record-user-answer",
        decisionId,
        answer,
        approved: approved ?? null,
        ...(attachments === undefined ? {} : { attachments }),
      });
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
  const withRecordedWorktree = <
    T extends { readonly threadId: ThreadId; readonly worktreePath: string },
  >(
    teammate: T,
  ) =>
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

  /**
   * The calling teammate: one of this environment's own, or one it hosts for another
   * environment's Pivot. A hosted teammate has no Pivot here, so its reports go to the
   * hosted log instead of the Pivot store.
   */
  const liveTeammate = (command: string, caller: ThreadId) =>
    Effect.gen(function* () {
      const teammate = yield* store.getTeammate(caller);
      const hosted = teammate === null ? yield* hostStore.getTeammate(caller) : null;
      if (teammate === null && hosted === null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "Only a teammate can use this tool.",
        });
      }
      if ((teammate ?? hosted)!.tornDownAt !== null) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "This teammate was torn down.",
        });
      }
      if (hosted !== null && !(yield* hostStore.isLive(hosted.threadId))) {
        return yield* new PivotCallerError({
          tool: command,
          reason: "This teammate's host link was revoked, or no longer allows its project.",
        });
      }
      return teammate !== null
        ? ({ type: "local", teammate: yield* withRecordedWorktree(teammate) } as const)
        : ({ type: "hosted", teammate: yield* withRecordedWorktree(hosted!) } as const);
    });

  /** The host a teammate runs on, by its environment; null is the home. */
  const hostFor = (
    command: string,
    environmentId: PivotStore.TeammateRow["environmentId"],
  ): Effect.Effect<TeammateHost["Service"], PivotStore.PivotRefusedError> =>
    environmentId === null
      ? Effect.succeed(localHost)
      : Effect.fail(refuse(command, `No host is connected for environment ${environmentId}.`));

  const hostOf = (command: string, teammate: PivotStore.TeammateRow) =>
    hostFor(command, teammate.environmentId);

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
          const host = yield* hostFor(command, null);
          const project = yield* host.project(command, pivot.projectId);
          const choice = chooseTeammateModel(
            yield* teammateModels(pivot.projectId),
            yield* teammateKindModels(pivot.projectId),
            input,
          );
          if (choice.type === "refused") return yield* refuse(command, choice.reason);
          if (input.kind !== "inline") {
            const cap = yield* teammateCap;
            const running = (yield* store.listTeammates({ includeTornDown: false })).filter(
              (teammate) =>
                teammate.pivotThreadId === pivot.threadId &&
                teammate.kind !== "inline" &&
                (teammate.observedStatus === null ||
                  teammate.observedStatus === "working" ||
                  teammate.observedStatus === "waiting"),
            );
            if (cap !== null && running.length >= cap) {
              return yield* refuse(
                command,
                `${running.length} teammates are already running, the most at once (${cap}). Queue this one and dispatch it when one finishes, or do it inline if it is small.`,
              );
            }
          }
          const pivotShell = yield* threads.shell(pivot.threadId);
          const modelSelection =
            choice.modelSelection ??
            project.defaultModelSelection ??
            pivotShell?.modelSelection ??
            null;
          if (modelSelection === null) {
            return yield* refuse(command, "No model to run the teammate on. Name one.");
          }
          const launched = yield* host.launch({
            projectId: pivot.projectId,
            pivotThreadId: pivot.threadId,
            title: input.title,
            kind: input.kind,
            intent: input.intent,
            spec: input.spec,
            baseBranch: input.baseBranch,
            modelSelection,
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
              branch: launched.branch,
              baseBranch: launched.baseBranch,
              worktreePath: launched.runId === null ? null : launched.worktreePath,
              deliveryMode: launched.deliveryMode,
              intent: input.intent,
              spec: input.spec,
              modelEntry: choice.entry,
            })
            .pipe(Effect.tapError(() => host.discard(launched.threadId).pipe(Effect.ignore)));
          const start =
            launched.runId === null
              ? ({ type: "failed", runId: null, detail: "The launch created no run." } as const)
              : yield* host.awaitStart(launched.threadId, launched.runId);
          // A failing setup script still starts the teammate; the result says so.
          const setup = yield* host.setupOutcome(launched.threadId);
          return {
            threadId: launched.threadId,
            title: input.title,
            kind: input.kind,
            branch: launched.branch,
            baseBranch: launched.baseBranch,
            worktreePath: launched.worktreePath,
            deliveryMode: launched.deliveryMode,
            modelEntry: choice.entry,
            firstRun: start.type,
            detail: start.type === "failed" ? start.detail : null,
            setupScript: setup.status,
            setupDetail: setup.detail,
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
      yield* (yield* hostOf(command, teammate)).send({
        threadId: teammate.threadId,
        senderThreadId: pivot.threadId,
        text: message,
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
      yield* (yield* hostOf(command, teammate)).send({
        threadId: teammate.threadId,
        senderThreadId: pivot.threadId,
        text: [
          "The user added to your task. Their words, which join the intent in your brief:",
          "",
          input.intent.trim(),
          ...(own.length > 0 ? ["", own] : []),
        ].join("\n"),
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
          yield* (yield* hostOf(command, teammate)).send({
            threadId: decision.teammateThreadId,
            senderThreadId: pivot.threadId,
            text: input.answer,
            attachments: decision.userAttachments,
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
              usageLimitResetAt: shell.usageLimitResetAt ?? null,
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
        // A teammate waiting for the machine to have memory has no run to report on yet.
        summary: teammate.memoryWait ?? derived.detail ?? teammate.report?.summary ?? null,
        branch: teammate.branch,
        pullRequestUrl: pullRequest,
        lastChangeAt: latest?.occurredAt ?? null,
        worktreePath: teammate.worktreePath,
        modelEntry: teammate.modelEntry,
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
      yield* (yield* hostOf(command, teammate)).stop(teammate.threadId);
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
      const host = yield* hostOf(command, teammate);
      const start = launchFailed
        ? yield* host.retryLaunch(teammate.threadId)
        : yield* host.relaunch({
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

  /** Why a decision does not carry the user's approval, or null when it does. */
  const notApproved = (decision: PivotDecision, what: string): string | null => {
    if (decision.escalation?.asksApproval !== true) {
      return `${what} needs the user's approval: escalate this decision with asksApproval and wait for their answer.`;
    }
    if (decision.userAnswer === null) return `${what} is waiting for the user to approve.`;
    if (decision.userApproved !== true) {
      return `The user declined ${what.toLowerCase()}: "${decision.userAnswer}"`;
    }
    return null;
  };

  /** A decision about this teammate that the user approved, in their recorded answer. */
  const userApproval = (
    command: string,
    pivot: PivotStore.PivotRow,
    teammate: PivotStore.TeammateRow,
    decisionId: PivotDecisionId,
    what: string,
  ) =>
    Effect.gen(function* () {
      const decision = yield* teammateDecision(command, pivot, teammate, decisionId);
      const reason = notApproved(decision, what);
      if (reason !== null) return yield* refuse(command, reason);
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

  /** Whether the PR merged: its synced state, else its live state when the sync lags. */
  const pullRequestMerged = (
    command: string,
    teammate: PivotStore.TeammateRow,
    link: ThreadPullRequestLink,
  ) =>
    link.snapshot?.state === "merged"
      ? Effect.succeed(true)
      : hostOf(command, teammate).pipe(
          Effect.flatMap((host) =>
            host.pullRequestDetail({
              projectId: teammate.projectId,
              host: link.host,
              repository: link.repository,
              number: link.number,
            }),
          ),
          Effect.map((detail) => detail.state === "merged"),
          Effect.orElseSucceed(() => false),
        );

  /**
   * Why landing `teammate` now would break merge order, or nothing. It refuses a branch
   * stacked on another teammate's unlanded work, a branch whose predecessors in the
   * decision's `mergeOrder` have not landed, and any unmerged PR of the Pivot's, its own
   * links included, that the order leaves out, so no finished work is forgotten.
   */
  const mergeOrderRefusals = (
    command: string,
    pivot: PivotStore.PivotRow,
    teammate: PivotStore.TeammateRow,
    decision: PivotDecision,
  ) =>
    Effect.gen(function* () {
      const teammates = yield* store.listTeammates({
        pivotThreadId: pivot.threadId,
        includeTornDown: true,
      });
      const live = teammates.filter((other) => other.tornDownAt === null);
      const pullRequests = (yield* Effect.forEach(
        [
          ...live.map((other) => [other.threadId, other.branch] as const),
          [pivot.threadId, null] as const,
        ],
        ([threadId, branch]) =>
          threads.shell(threadId).pipe(
            Effect.map((shell) =>
              (shell?.pullRequests ?? [])
                .filter((link) => link.source !== "stack-dismissed")
                .map((link) => ({
                  link,
                  branch: link.snapshot?.headBranch ?? branch ?? link.url,
                })),
            ),
          ),
      )).flat();
      const landedLocally = Effect.fn("PivotService.landedLocally")(function* (
        other: PivotStore.TeammateRow,
      ) {
        const verdict = yield* (yield* hostOf(command, other)).landed(command, {
          projectId: pivot.projectId,
          worktreePath: other.worktreePath,
          branch: other.branch,
          mergedPullRequestHead: null,
        });
        return verdict.landed;
      });
      /** Whether the work on `branch` has landed; null for a branch that is no work of the Pivot's. */
      const landed = Effect.fn("PivotService.branchLanded")(function* (branch: string) {
        const owner = teammates.find((other) => other.branch === branch);
        if (owner?.tornDownAt != null) return true;
        if (owner?.deliveryMode === "local-only") return yield* landedLocally(owner);
        const links = pullRequests.filter((pr) => pr.branch === branch);
        if (owner === undefined && links.length === 0) return null;
        for (const { link } of links) {
          if (yield* pullRequestMerged(command, teammate, link)) return true;
        }
        return false;
      });

      const reasons: Array<string> = [];
      const own = yield* linkedPullRequest(teammate);
      const bases = new Set([teammate.baseBranch, own?.snapshot?.baseBranch]);
      for (const other of live) {
        if (other.threadId === teammate.threadId || !bases.has(other.branch)) continue;
        if (!(yield* landed(other.branch))) {
          reasons.push(
            `It is stacked on ${other.branch} ("${other.title}"), which has not landed. Land that first.`,
          );
        }
      }

      const order = decision.escalation?.mergeOrder ?? [];
      const position = order.indexOf(teammate.branch);
      if (order.length > 0 && position === -1) {
        reasons.push(`The decision's merge order does not list ${teammate.branch}.`);
      }
      for (const branch of order.slice(0, Math.max(position, 0))) {
        const verdict = yield* landed(branch);
        if (verdict === null) {
          reasons.push(`The merge order lists ${branch}, which is no branch of your teammates'.`);
        } else if (!verdict) {
          reasons.push(`${branch} comes before it in the merge order and has not landed.`);
        }
      }
      const unordered = yield* Effect.filter(
        pullRequests.filter((pr) => pr.branch !== teammate.branch && !order.includes(pr.branch)),
        (pr) => pullRequestMerged(command, teammate, pr.link).pipe(Effect.map((merged) => !merged)),
      );
      if (unordered.length > 0) {
        const listed = unordered.map((pr) => `${pr.link.url} (${pr.branch})`).join(", ");
        reasons.push(
          `Unmerged and missing from the decision's merge order: ${listed}. Escalate the merge with a mergeOrder listing every unmerged branch, so the user approves the order.`,
        );
      }
      return reasons;
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
      const host = yield* hostOf(command, teammate);
      const detail = yield* host.pullRequestDetail(ref);
      if (!PIVOT_MERGE_PROVIDERS.has(detail.provider)) {
        return yield* refuse(
          command,
          `The Pivot merges on GitHub and GitLab only. Ask the user to merge ${link.url} on ${detail.provider} by hand.`,
        );
      }
      const waived = input.waivedChecks ?? [];
      // Every failing condition at once: the approval, each waiver, and live state.
      const reasons = [
        ...[notApproved(decision, "Merging")].filter((reason) => reason !== null),
        ...waived.flatMap((name) =>
          decision.userAnswer !== null && decision.userAnswer.includes(name)
            ? []
            : [`The user's answer does not waive check "${name}" by name.`],
        ),
        ...mergeRefusals(detail, waived),
        ...(yield* mergeOrderRefusals(command, pivot, teammate, decision)),
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
      yield* host
        .mergePullRequest({ ...ref, expectedHeadSha: head })
        .pipe(Effect.tapError(() => recordMerge(null).pipe(Effect.ignore)));
      yield* host.stopScope(teammate.threadId);
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
      const decision = yield* userApproval(command, pivot, teammate, input.decisionId, "Landing");
      const outOfOrder = yield* mergeOrderRefusals(command, pivot, teammate, decision);
      if (outOfOrder.length > 0) {
        return yield* refuse(
          command,
          `Not landing ${teammate.branch}:\n- ${outOfOrder.join("\n- ")}`,
        );
      }
      const result = yield* (yield* hostOf(command, teammate)).land(command, {
        projectId: pivot.projectId,
        worktreePath: teammate.worktreePath,
        branch: teammate.branch,
      });
      if (result.type === "refused") return yield* refuse(command, result.reason);
      yield* store.dispatch({
        type: "teammate.record-landing",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
        head: result.head,
      });
      yield* (yield* hostOf(command, teammate)).stopScope(teammate.threadId);
      return {
        threadId: teammate.threadId,
        branch: teammate.branch,
        defaultBranch: result.defaultBranch,
        landedHead: result.head,
      };
    });

  const teardownTeammate: PivotService["Service"]["teardownTeammate"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "teardown_teammate";
      const pivot = yield* activePivot(command, caller);
      const teammate = yield* ownTeammate(command, pivot, input.threadId);
      const host = yield* hostOf(command, teammate);
      yield* host.project(command, pivot.projectId);
      // Teardown deletes the worktree and branch, so nobody else may still be using them.
      const others = (yield* store.listTeammates({ includeTornDown: false })).filter(
        (other) => other.threadId !== teammate.threadId && other.projectId === teammate.projectId,
      );
      const sharing: Array<PivotStore.TeammateRow> = [];
      for (const other of others) {
        const resolved = yield* withRecordedWorktree(other);
        if (
          resolved.worktreePath === teammate.worktreePath ||
          resolved.branch === teammate.branch
        ) {
          sharing.push(resolved);
        }
      }
      if (sharing.length > 0) {
        return yield* refuse(
          command,
          `Not torn down: ${sharing.map((other) => other.threadId).join(", ")} still ${sharing.length === 1 ? "works" : "work"} on the same worktree or branch. Tear that one down first, or hand the work over.`,
        );
      }
      const worktreeExists = yield* host.worktreeExists(teammate.worktreePath);

      let reason: string;
      let landedHead: string | null = null;
      if (teammate.kind === "scout" && teammate.scoutReport !== null) {
        reason = "Its scout report is recorded.";
        // The report is the deliverable, but files it left uncommitted are still the user's.
        if (worktreeExists && !(yield* host.worktreeClean(teammate.worktreePath))) {
          if (input.discardDecisionId === undefined) {
            return yield* refuse(
              command,
              "Not torn down: the scout's worktree has uncommitted files. Its report is recorded; discarding the files needs the user's word.",
            );
          }
          yield* userApproval(command, pivot, teammate, input.discardDecisionId, "Discarding work");
          reason =
            "Discarded on the user's word: the scout's uncommitted files. Its scout report is recorded.";
        }
      } else {
        const link = yield* linkedPullRequest(teammate);
        let mergedHead: string | null = null;
        if (link?.snapshot?.state === "merged") {
          const detail = yield* host
            .pullRequestDetail({
              projectId: teammate.projectId,
              host: link.host,
              repository: link.repository,
              number: link.number,
            })
            .pipe(Effect.orElseSucceed(() => null));
          mergedHead = detail?.state === "merged" ? (detail.headSha ?? null) : null;
        }
        const verdict = yield* host.landed(command, {
          projectId: pivot.projectId,
          worktreePath: teammate.worktreePath,
          branch: teammate.branch,
          mergedPullRequestHead: mergedHead,
        });
        if (verdict.landed) {
          reason = verdict.reason;
          landedHead = verdict.head;
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
      // Landed work's branch goes while it is still at the verified tip; a scout's
      // report-only branch goes only if git agrees it is merged; discarded work keeps it.
      const branchDisposal =
        discarding || (landedHead === null && teammate.kind !== "scout")
          ? ("keep" as const)
          : landedHead === null
            ? ("safe" as const)
            : { tip: landedHead };

      yield* host.teardown(command, {
        projectId: pivot.projectId,
        threadId: teammate.threadId,
        worktreePath: teammate.worktreePath,
        branch: teammate.branch,
        worktreeExists,
        force: discarding,
        branchDisposal,
        inline: teammate.kind === "inline",
      });
      yield* store.dispatch({
        type: "teammate.tear-down",
        pivotThreadId: pivot.threadId,
        threadId: teammate.threadId,
      });
      return { threadId: teammate.threadId, reason, branch: teammate.branch };
    });

  // --- Teammate tools ---

  // A ship waiting on review holds no dev server; "start it" brings one back on the same port.
  // A scout's checkout is the user's own, so its servers are not the scout's to stop.
  const stopServersAtDone = (
    status: PivotMcpReportStatusInput["status"],
    teammate: { readonly kind: string; readonly worktreePath: string },
  ) =>
    status === "done" && teammate.kind === "ship"
      ? localHost.stopServers(teammate.worktreePath)
      : Effect.void;

  const reportStatus: PivotService["Service"]["reportStatus"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "report_status";
      const calling = yield* liveTeammate(command, caller);
      const teammate = calling.teammate;
      const shell = yield* threads.shell(teammate.threadId);
      if (input.status === "done" && teammate.kind === "ship") {
        const unsaved = yield* git.uncommitted(teammate.worktreePath);
        if (unsaved.length > 0) {
          return yield* refuse(
            command,
            `\`done\` needs all work committed. Uncommitted: ${unsaved.join(", ")}. Commit it, then report again.`,
          );
        }
      }
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
      if (calling.type === "hosted") {
        // The home holds the Pivot, its decisions and its wakes; this host only logs the
        // report, for the home to apply when it next reads the log.
        if (input.until !== undefined && input.status !== "paused") {
          return yield* refuse(command, "Only a `paused` report takes `until`.");
        }
        yield* hostStore.appendEvent({
          threadId: teammate.threadId,
          event: {
            _tag: "reported",
            status: input.status,
            summary: input.summary,
            until: input.until ?? null,
            runId: shell?.latestRunId ?? null,
            decisionKey: input.decisionKey ?? null,
            clearedDecision:
              input.clearDecision === undefined
                ? null
                : {
                    key: input.clearDecision.key ?? null,
                    resolution: input.clearDecision.resolution,
                  },
          },
        });
        yield* stopServersAtDone(input.status, teammate);
        return { status: input.status, openDecisions: 0 };
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
      yield* stopServersAtDone(input.status, teammate);
      const decisions = yield* store.listDecisions({
        pivotThreadId: calling.teammate.pivotThreadId,
        openOnly: true,
      });
      return {
        status: input.status,
        openDecisions: decisions.filter((d) => d.teammateThreadId === teammate.threadId).length,
      };
    });

  const recordScoutReport: PivotService["Service"]["recordScoutReport"] = (caller, input) =>
    Effect.gen(function* () {
      const command = "record_scout_report";
      const calling = yield* liveTeammate(command, caller);
      if (calling.type === "hosted") {
        if (calling.teammate.kind !== "scout") {
          return yield* refuse(command, "Only a scout records a report.");
        }
        yield* hostStore.appendEvent({
          threadId: calling.teammate.threadId,
          event: { _tag: "scout-report-recorded", report: input.report },
        });
        return { recorded: true };
      }
      yield* store.dispatch({
        type: "teammate.record-scout-report",
        threadId: calling.teammate.threadId,
        report: input.report,
      });
      return { recorded: true };
    });

  return PivotService.of({
    create,
    refreshHomes,
    stream: store.stream,
    teammateDetail,
    decisionLog,
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

export const layer = Layer.effect(PivotService, make).pipe(
  Layer.provideMerge(LocalTeammateHost.layer),
);
