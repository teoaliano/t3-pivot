import type {
  OrchestrationV2ThreadShell,
  TeammateRecord,
  TeammateStatus,
  ThreadId,
  ThreadPullRequestLink,
  WorktreeSetupSnapshot,
  WorktreeSetupStageId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { deriveTeammateStatus, type TeammateStatusInput } from "@t3tools/shared/teammateStatus";

/**
 * The teammate cards in the Pivot view, as data. A card shows its status (dot,
 * elapsed time, label), title, PR number or "Scout", and provider. Cards keep
 * dispatch order; finished teammates fold into one chip at the end.
 */

/** What a card reads from the teammate's V2 thread shell. */
export interface TeammateCardShell extends Omit<TeammateStatusInput, "teammate"> {
  readonly title: string;
  readonly providerInstanceId: string;
  readonly latestRunStartedAt: string | null;
  readonly latestRunCompletedAt: string | null;
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  /** Settled like any thread: by hand, or automatically once its PR merged or closed. */
  readonly settled: boolean;
}

/**
 * The thread status color a teammate wears, as normal threads in the sidebar: blue
 * while working, orange while it needs someone, green while resting, red when failed.
 */
export type TeammateTone = "working" | "attention" | "resting" | "failed";

export const TEAMMATE_TONE_CLASSES: Record<
  TeammateTone,
  { readonly text: string; readonly dot: string }
> = {
  working: { text: "text-info", dot: "bg-info" },
  attention: { text: "text-warning-foreground", dot: "bg-warning" },
  resting: { text: "text-success", dot: "bg-success" },
  failed: { text: "text-error", dot: "bg-destructive" },
};

export interface TeammateCard {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: TeammateStatus;
  /** A held decision or a waiting approval outranks the status: the card asks for the user. */
  readonly needsYou: boolean;
  readonly label: string;
  /** Accent border: something here needs someone's action. */
  readonly attention: boolean;
  readonly tone: TeammateTone;
  /** Finished for good: torn down, or its thread settled. Hidden from the sidebar. */
  readonly settled: boolean;
  /** When the current status began, for the elapsed time. */
  readonly since: string | null;
  readonly footer:
    | { readonly kind: "pull-request"; readonly number: number; readonly url: string }
    | { readonly kind: "scout" }
    | null;
  readonly providerInstanceId: string | null;
  readonly detail: string | null;
  /** Before its first report, the card follows the worktree setup. */
  readonly followsSetup: boolean;
}

export interface TeammateCards {
  /** In dispatch order. */
  readonly live: ReadonlyArray<TeammateCard>;
  /** Done or torn down, in dispatch order, behind the "N finished" chip. */
  readonly finished: ReadonlyArray<TeammateCard>;
}

const STATUS_LABEL: Record<TeammateStatus, string> = {
  working: "Working",
  waiting: "Waiting on approval",
  "needs-decision": "Needs a decision",
  blocked: "Blocked",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  unreported: "Stopped",
};

const ATTENTION: ReadonlySet<TeammateStatus> = new Set([
  "waiting",
  "blocked",
  "failed",
  "unreported",
]);

export function teammateCard(
  teammate: TeammateRecord,
  shell: TeammateCardShell | null,
): TeammateCard {
  // A cleaned-up teammate is finished: its archived thread no longer says anything.
  const derived =
    teammate.tornDownAt !== null
      ? { status: "done" as const, detail: teammate.report?.summary ?? null }
      : shell === null
        ? { status: "unreported" as const, detail: teammate.report?.summary ?? null }
        : deriveTeammateStatus({ ...shell, teammate });
  // Anything waiting on the user: a decision the Pivot holds for them, or an approval
  // the teammate is waiting on.
  const needsYou = teammate.hasEscalatedDecision || derived.status === "waiting";
  const reportInLatestRun =
    teammate.report !== null && shell !== null && teammate.report.runId === shell.latestRunId
      ? teammate.report.reportedAt
      : null;
  const attention = needsYou || ATTENTION.has(derived.status);
  return {
    threadId: teammate.threadId,
    title: shell?.title || teammate.title,
    status: derived.status,
    needsYou,
    label: needsYou ? "Needs you" : STATUS_LABEL[derived.status],
    attention,
    tone:
      derived.status === "failed"
        ? "failed"
        : attention
          ? "attention"
          : derived.status === "working"
            ? "working"
            : "resting",
    // Anything asking for the user stays in view, as a settled thread wakes on a request.
    settled: !needsYou && (teammate.tornDownAt !== null || shell?.settled === true),
    since:
      derived.status === "working"
        ? (shell?.latestRunStartedAt ?? teammate.dispatchedAt)
        : (reportInLatestRun ?? shell?.latestRunCompletedAt ?? teammate.dispatchedAt),
    footer:
      teammate.kind === "scout"
        ? { kind: "scout" }
        : shell?.pullRequest
          ? { kind: "pull-request", ...shell.pullRequest }
          : null,
    providerInstanceId: shell?.providerInstanceId ?? null,
    detail: derived.detail,
    followsSetup: teammate.report === null && teammate.tornDownAt === null,
  };
}

/** The cards for a Pivot's teammates, already in dispatch order. */
export function teammateCards(
  teammates: ReadonlyArray<TeammateRecord>,
  shellOf: (threadId: ThreadId) => TeammateCardShell | null,
): TeammateCards {
  const live: Array<TeammateCard> = [];
  const finished: Array<TeammateCard> = [];
  for (const teammate of teammates) {
    const card = teammateCard(teammate, shellOf(teammate.threadId));
    const isFinished = teammate.tornDownAt !== null || (card.status === "done" && !card.needsYou);
    (isFinished ? finished : live).push(card);
  }
  return { live, finished };
}

/** Elapsed time, coarse on purpose: the card re-renders at most once a minute. */
export function elapsedLabel(since: string | null, nowMs: number): string | null {
  if (since === null) return null;
  const startedMs = Date.parse(since);
  if (Number.isNaN(startedMs)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - startedMs) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const isoOrNull = (value: DateTime.Utc | null | undefined): string | null =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

/** What a card reads, from the teammate's V2 shell and its linked PRs. */
export function teammateCardShellOf(
  source: OrchestrationV2ThreadShell,
  pullRequests: ReadonlyArray<ThreadPullRequestLink>,
): TeammateCardShell {
  const link = pullRequests.find((candidate) => candidate.source !== "stack-dismissed") ?? null;
  return {
    title: source.title,
    providerInstanceId: source.providerInstanceId,
    status: source.status,
    latestRunId: source.latestRunId,
    pendingRuntimeRequest: source.pendingRuntimeRequest,
    pendingBackgroundTasks: source.pendingBackgroundTasks ?? [],
    lastError: source.lastError ?? null,
    usageLimitResetAt: source.usageLimitResetAt ?? null,
    latestRunStartedAt: isoOrNull(source.latestRunStartedAt),
    latestRunCompletedAt: isoOrNull(source.latestRunCompletedAt),
    pullRequest: link === null ? null : { number: link.number, url: link.url },
    settled: source.settledOverride === "settled",
  };
}

const SETUP_STAGE_LABELS: Record<WorktreeSetupStageId, string> = {
  fetch: "Fetching the base branch",
  checkout: "Checking out",
  submodules: "Setting up submodules",
  "setup-script": "Running the setup script",
  agent: "Starting the agent",
};

/**
 * One line of worktree setup for a card: the stage in progress, or how setup went
 * wrong. Null once setup finished cleanly, so a healthy card says nothing about it.
 */
export function setupProgressLine(snapshot: WorktreeSetupSnapshot | null): string | null {
  if (snapshot === null) return null;
  if (snapshot.phase === "cancelled") return "Setup cancelled";
  if (snapshot.phase === "failed") {
    return snapshot.error === null ? "Setup failed" : `Setup failed: ${snapshot.error}`;
  }
  const scriptFailed = snapshot.stages.find(
    (stage) => stage.id === "setup-script" && stage.status === "failed",
  );
  if (scriptFailed !== undefined) {
    return scriptFailed.detail === null
      ? "Setup script failed"
      : `Setup script failed: ${scriptFailed.detail}`;
  }
  if (snapshot.phase !== "running") return null;
  const current = snapshot.stages.find((stage) => stage.status === "running");
  if (current === undefined) return "Setting up";
  const label = SETUP_STAGE_LABELS[current.id];
  return current.percent === null ? label : `${label} ${current.percent}%`;
}
