/**
 * What a wake says. Pure: the Pivot-log events since the last wake, the
 * teammates' current state and the open decisions go in; the notice text, its
 * one-line summary and the teammates it names come out.
 */
import type {
  ChatImageAttachment,
  PivotDecision,
  TeammateKind,
  TeammateResumeState,
  TeammateStatus,
  ThreadId,
} from "@t3tools/contracts";

import type { StoredPivotEvent } from "./PivotEvents.ts";

export interface WakeTeammate {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly kind: TeammateKind;
  readonly status: TeammateStatus;
  readonly summary: string | null;
  readonly resume: TeammateResumeState | null;
  readonly tornDown: boolean;
  /** Where it works, and the user's first words for it: what a digest names for each teammate. */
  readonly branch: string;
  readonly worktreePath: string;
  readonly goal: string | null;
  readonly verdict: string | null;
}

/** A wake that tells the whole state, not only what changed. */
export type WakeDigest =
  | { readonly kind: "restart" }
  | {
      readonly kind: "takeover";
      readonly predecessorThreadId: ThreadId;
      /** The retired Pivot's handoff; null when it wrote none in time. */
      readonly handoff: string | null;
    };

export interface WakeInput {
  readonly events: ReadonlyArray<StoredPivotEvent>;
  /** Every teammate of the Pivot, live or torn down, by thread id. */
  readonly teammates: ReadonlyMap<string, WakeTeammate>;
  readonly openDecisions: ReadonlyArray<PivotDecision>;
  readonly digest: WakeDigest | null;
  /** The texts attached when a teammate in the wake is stuck or unreported, or failed. */
  readonly guidance: { readonly stuck: string; readonly failed: string };
}

export interface Wake {
  readonly text: string;
  readonly summary: string;
  readonly teammateThreadIds: ReadonlyArray<ThreadId>;
  /** Images the user attached to answers this wake reports, to send with it. */
  readonly attachments: ReadonlyArray<ChatImageAttachment>;
}

const quote = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return `"${flat.length > 400 ? `${flat.slice(0, 399)}…` : flat}"`;
};

/** The user's own words, whole: the Pivot relays them, so nothing is clipped or reflowed. */
const verbatim = (text: string) => `"${text}"`;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a digest adds under a teammate: where it works, its goal and your verdict. */
const digestNotes = (teammate: WakeTeammate): ReadonlyArray<string> =>
  teammate.tornDown
    ? []
    : [
        `On ${teammate.branch} in ${teammate.worktreePath}.`,
        ...(teammate.goal === null ? [] : [`Goal: ${quote(teammate.goal)}`]),
        ...(teammate.verdict === null ? [] : [`Your verdict: ${quote(teammate.verdict)}`]),
      ];

const teammateLine = (teammate: WakeTeammate) => {
  const summary = teammate.summary === null ? "" : ` — ${teammate.summary}`;
  const resume =
    teammate.resume === "pending"
      ? " (resuming after the restart)"
      : teammate.resume === "failed"
        ? " (did not survive the restart)"
        : "";
  return `- ${quote(teammate.title)} (${teammate.kind}, thread ${teammate.threadId}): ${teammate.status}${resume}${summary}`;
};

/** The notes an event adds under its teammate, beyond the status line. */
const eventNote = (stored: StoredPivotEvent): string | null => {
  const event = stored.event;
  switch (event.type) {
    case "teammate.user-message":
      return `The user wrote to it directly: ${quote(event.text)}`;
    case "teammate.delivery-changed":
      return event.change === "merged"
        ? `Its PR merged outside T3: ${event.url}`
        : event.change === "closed"
          ? `Its PR was closed without merging: ${event.url}`
          : `Checks went red on its PR after it reported done: ${event.url}`;
    case "teammate.request-answered":
      return `Its pending approval or question was answered: ${quote(event.answer)}`;
    case "teammate.scout-report-recorded":
      return event.checkoutChanges === undefined
        ? null
        : `Files changed in the user's checkout while it ran, though a scout must not write there: ${event.checkoutChanges.join(", ")}. Check them with the user before anything else.`;
    case "teammate.stuck":
      return "No activity for 30 minutes while running.";
    case "teammate.pause-rechecked":
      return "Its wait was due for a recheck.";
    default:
      return null;
  }
};

const teammateOf = (stored: StoredPivotEvent): string | null =>
  "threadId" in stored.event && stored.event.type.startsWith("teammate.")
    ? stored.event.threadId
    : null;

const decisionLine = (
  decision: PivotDecision,
  teammates: ReadonlyMap<string, WakeTeammate>,
  answeredHere: boolean,
) => {
  const owner =
    decision.teammateThreadId === null
      ? "your own"
      : `on ${quote(teammates.get(decision.teammateThreadId)?.title ?? decision.teammateThreadId)}`;
  const images = decision.userAttachments?.length ?? 0;
  const withImages =
    images === 0
      ? ""
      : answeredHere
        ? ` with ${plural(images, "image")}, attached to this notice`
        : ` with ${plural(images, "image")}`;
  const state =
    decision.userAnswer !== null
      ? `The user answered ${verbatim(decision.userAnswer)}${withImages}. Relay it with answer_decision.`
      : decision.escalatedAt !== null
        ? "Held for the user."
        : "Yours to answer or escalate.";
  return `- ${decision.decisionId} (${owner}): ${quote(decision.summary)} ${state}`;
};

export const composeWake = (input: WakeInput): Wake => {
  const answeredHere = new Set<string>();
  for (const { event } of input.events) {
    if (event.type === "decision.user-answered") answeredHere.add(event.decisionId);
  }
  const attachments = input.openDecisions
    .filter((decision) => answeredHere.has(decision.decisionId))
    .flatMap((decision) => decision.userAttachments ?? []);
  const changed = new Map<string, Array<string>>();
  for (const stored of input.events) {
    const threadId = teammateOf(stored);
    if (threadId === null) continue;
    const notes = changed.get(threadId) ?? [];
    const note = eventNote(stored);
    if (note !== null) notes.push(note);
    changed.set(threadId, notes);
  }
  // A user's answer reaches the Pivot through the decision it closes; name its teammate.
  for (const { event } of input.events) {
    if (event.type !== "decision.user-answered") continue;
    const decision = input.openDecisions.find((d) => d.decisionId === event.decisionId);
    if (decision?.teammateThreadId != null && !changed.has(decision.teammateThreadId)) {
      changed.set(decision.teammateThreadId, []);
    }
  }

  const listed =
    input.digest === null
      ? [...changed.keys()].flatMap((id) => {
          const teammate = input.teammates.get(id);
          return teammate === undefined ? [] : [teammate];
        })
      : [...input.teammates.values()].filter(
          (teammate) => !teammate.tornDown || changed.has(teammate.threadId),
        );

  const lines: Array<string> = [];
  if (input.digest?.kind === "restart") {
    lines.push("The server restarted since your last wake. Where every teammate stands now:");
  } else if (input.digest?.kind === "takeover") {
    lines.push(
      `You took over from the retired Pivot in thread ${input.digest.predecessorThreadId}.`,
    );
    if (input.digest.handoff === null) {
      lines.push(
        "It did not write a handoff in time, so what only its conversation held is missing: plans not yet dispatched, what the user is waiting on or agreed to, preferences it did not save. Ask the user, or read its transcript.",
      );
    } else {
      lines.push("Its handoff, written as it retired:", "", input.digest.handoff.trim());
    }
    lines.push("", "Where every teammate stands now:");
  } else {
    lines.push("Teammates that changed:");
  }
  if (listed.length === 0) lines.push("- None.");
  for (const teammate of listed) {
    lines.push(teammateLine(teammate));
    if (input.digest !== null) for (const note of digestNotes(teammate)) lines.push(`  · ${note}`);
    for (const note of changed.get(teammate.threadId) ?? []) lines.push(`  · ${note}`);
  }

  lines.push("", input.openDecisions.length === 0 ? "No open decisions." : "Open decisions:");
  for (const decision of input.openDecisions) {
    lines.push(decisionLine(decision, input.teammates, answeredHere.has(decision.decisionId)));
  }

  const batches = input.openDecisions.filter(
    (decision) => (decision.escalation?.shipGroups?.length ?? 0) > 0,
  );
  if (input.digest !== null && batches.length > 0) {
    lines.push("", "Ship batches waiting:");
    for (const batch of batches) {
      const state =
        batch.userApproved === true
          ? "approved, its leads told to ship"
          : batch.userAnswer !== null
            ? "declined"
            : "held for the user";
      const title = (threadId: ThreadId) => quote(input.teammates.get(threadId)?.title ?? threadId);
      const groups = (batch.escalation?.shipGroups ?? []).map(
        (group, index) =>
          `${index + 1}. ${title(group.lead)}${group.members.length === 0 ? "" : ` with ${group.members.map(title).join(", ")}`}`,
      );
      lines.push(`- ${batch.decisionId}, ${state}: ${groups.join("; ")}`);
    }
  }

  if (input.digest?.kind === "takeover") {
    lines.push(
      "",
      `Read its transcript only when the user refers to earlier work or you need to verify what a retired teammate did: thread ${input.digest.predecessorThreadId}, with t3_thread_read. read_handoff brings back its handoff after a compaction.`,
    );
  }

  const needsLadder = listed.some(
    (teammate) =>
      teammate.status === "unreported" ||
      (changed.get(teammate.threadId) ?? []).some((note) => note.startsWith("No activity")),
  );
  const needsDiagnosis = listed.some((teammate) => teammate.status === "failed");
  if (needsLadder) lines.push("", input.guidance.stuck.trim());
  if (needsDiagnosis) lines.push("", input.guidance.failed.trim());

  const decisionsSummary =
    input.openDecisions.length === 0
      ? null
      : `${plural(input.openDecisions.length, "decision")} open`;
  const summary =
    input.digest?.kind === "restart"
      ? `Restart: ${plural(listed.length, "teammate")}`
      : input.digest?.kind === "takeover"
        ? `Took over ${plural(listed.length, "teammate")}`
        : listed.length === 0
          ? (decisionsSummary ?? "Decisions changed")
          : `${plural(listed.length, "teammate")} changed`;

  return {
    text: lines.join("\n"),
    summary:
      decisionsSummary === null || summary === decisionsSummary
        ? summary
        : `${summary} · ${decisionsSummary}`,
    teammateThreadIds: listed.map((teammate) => teammate.threadId),
    attachments,
  };
};
