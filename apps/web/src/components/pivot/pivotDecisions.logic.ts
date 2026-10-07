import type { PivotDecision } from "@t3tools/contracts";

export type DecisionOutcome = "open" | "pivot-answered" | "user-answered" | "moot" | "cleared";

export interface DecisionLogEntry {
  readonly outcome: DecisionOutcome;
  readonly label: string;
  /** The answer, evidence or how it cleared; the user's own words when they answered. */
  readonly text: string | null;
  /** When it closed, or when it last moved while open. */
  readonly at: string;
}

/**
 * How one decision reads in the Pivot's decision log. An answer the Pivot gave on its
 * own is labeled as the Pivot's, and only the user's verbatim answer reads as theirs.
 */
export function decisionLogEntry(decision: PivotDecision): DecisionLogEntry {
  const { resolution } = decision;
  if (resolution === null) {
    if (decision.userAnswer !== null) {
      return {
        outcome: "open",
        label: "You answered; the Pivot is relaying it",
        text: decision.userAnswer,
        at: decision.userAnsweredAt ?? decision.openedAt,
      };
    }
    return {
      outcome: "open",
      label: decision.escalatedAt === null ? "Open with the Pivot" : "Waiting for you",
      text: null,
      at: decision.escalatedAt ?? decision.openedAt,
    };
  }
  const at = resolution.closedAt;
  switch (resolution.kind) {
    case "answered":
      return decision.userAnswer === null
        ? {
            outcome: "pivot-answered",
            label: "The Pivot answered on its own",
            text: resolution.text,
            at,
          }
        : { outcome: "user-answered", label: "You answered", text: decision.userAnswer, at };
    case "moot":
      return { outcome: "moot", label: "Marked moot by the Pivot", text: resolution.text, at };
    case "cleared":
      return { outcome: "cleared", label: "Cleared by the teammate", text: resolution.text, at };
  }
}
