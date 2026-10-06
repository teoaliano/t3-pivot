import type { TeammateRecord, TeammateStatus, ThreadId } from "@t3tools/contracts";
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
}

export interface TeammateCard {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly status: TeammateStatus;
  /** An escalated decision outranks the status: the card asks for the user. */
  readonly needsYou: boolean;
  readonly label: string;
  /** Accent border: something here needs someone's action. */
  readonly attention: boolean;
  /** When the current status began, for the elapsed time. */
  readonly since: string | null;
  readonly footer:
    | { readonly kind: "pull-request"; readonly number: number; readonly url: string }
    | { readonly kind: "scout" }
    | null;
  readonly providerInstanceId: string | null;
  readonly detail: string | null;
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
  const derived =
    shell === null
      ? { status: "unreported" as const, detail: teammate.report?.summary ?? null }
      : deriveTeammateStatus({ ...shell, teammate });
  const needsYou = teammate.hasEscalatedDecision;
  const reportInLatestRun =
    teammate.report !== null && shell !== null && teammate.report.runId === shell.latestRunId
      ? teammate.report.reportedAt
      : null;
  return {
    threadId: teammate.threadId,
    title: shell?.title || teammate.title,
    status: derived.status,
    needsYou,
    label: needsYou ? "Needs you" : STATUS_LABEL[derived.status],
    attention: needsYou || ATTENTION.has(derived.status),
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
