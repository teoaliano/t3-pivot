import { type PivotDecision, PivotDecisionId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clampDecisionBodyHeight,
  decisionBodyDefaultMaxHeight,
  decisionLogEntry,
  recommendedOption,
  userAnswerLabel,
} from "./pivotDecisions.logic";

const decision = (overrides: Partial<PivotDecision> = {}): PivotDecision => ({
  decisionId: PivotDecisionId.make("d1"),
  pivotThreadId: ThreadId.make("pivot"),
  teammateThreadId: null,
  key: "default",
  openedBy: "pivot",
  summary: "Which port?",
  openedAt: "2026-10-06T10:00:00.000Z",
  escalation: null,
  escalatedAt: null,
  userAnswer: null,
  userAnsweredAt: null,
  userApproved: null,
  resolution: null,
  ...overrides,
});

const closed = (kind: "answered" | "cleared" | "moot", text: string) => ({
  resolution: { kind, text, closedAt: "2026-10-06T11:00:00.000Z" },
});

const escalation = {
  questions: ["Merge it?"] as const,
  evidence: "Checks are green.",
  consequence: "It ships.",
  options: [],
  recommendation: "Merge.",
};

describe("decisionLogEntry", () => {
  it("labels an answer the Pivot gave on its own as the Pivot's", () => {
    expect(decisionLogEntry(decision(closed("answered", "Use 3000.")))).toEqual({
      outcome: "pivot-answered",
      label: "The Pivot answered on its own",
      text: "Use 3000.",
      at: "2026-10-06T11:00:00.000Z",
    });
  });

  it("shows the user's own words for an answer they gave, not the Pivot's relay", () => {
    expect(
      decisionLogEntry(
        decision({
          escalation,
          escalatedAt: "2026-10-06T10:10:00.000Z",
          userAnswer: "Yes, merge it",
          userAnsweredAt: "2026-10-06T10:30:00.000Z",
          ...closed("answered", "The user approved the merge."),
        }),
      ),
    ).toMatchObject({ outcome: "user-answered", label: "You answered", text: "Yes, merge it" });
  });

  it("labels moot and cleared decisions as not the user's words", () => {
    expect(decisionLogEntry(decision(closed("moot", "Already configured.")))).toMatchObject({
      outcome: "moot",
      label: "Marked moot by the Pivot",
      text: "Already configured.",
    });
    expect(decisionLogEntry(decision(closed("cleared", "CI recovered.")))).toMatchObject({
      outcome: "cleared",
      label: "Cleared by the teammate",
    });
  });

  it("reads an open decision by where it waits", () => {
    expect(decisionLogEntry(decision())).toMatchObject({
      outcome: "open",
      label: "Open with the Pivot",
      text: null,
    });
    const held = decision({ escalation, escalatedAt: "2026-10-06T10:10:00.000Z" });
    expect(decisionLogEntry(held)).toMatchObject({ outcome: "open", label: "Waiting for you" });
    expect(
      decisionLogEntry({ ...held, userAnswer: "No", userAnsweredAt: "2026-10-06T10:20:00.000Z" }),
    ).toMatchObject({
      outcome: "open",
      label: "You answered; the Pivot is relaying it",
      text: "No",
    });
  });
});

describe("recommendedOption", () => {
  const options = ["Restart now", "Restart", "Wait until tonight"];

  it("matches the option a recommendation is, ignoring case and closing punctuation", () => {
    expect(recommendedOption(options, "wait until tonight.")).toBe("Wait until tonight");
  });

  it("matches the longest option a recommendation starts with", () => {
    expect(recommendedOption(options, "Restart now, nothing is running")).toBe("Restart now");
    expect(recommendedOption(options, "Restart: the build passed")).toBe("Restart");
  });

  it("does not match an option that is only a word prefix", () => {
    expect(recommendedOption(["Merge"], "Merged already")).toBeNull();
  });

  it("is null when the recommendation names no option", () => {
    expect(recommendedOption(options, "Ask the user first")).toBeNull();
    expect(recommendedOption([], "Merge.")).toBeNull();
  });
});

describe("userAnswerLabel", () => {
  it("reads an approval's answer as accepted or commented", () => {
    expect(userAnswerLabel(true)).toBe("You accepted");
    expect(userAnswerLabel(false)).toBe("You commented");
    expect(userAnswerLabel(null)).toBe("You answered");
  });
});

describe("clampDecisionBodyHeight", () => {
  it("keeps a dragged body between its minimum and what the canvas leaves room for", () => {
    expect(clampDecisionBodyHeight(40, 800)).toBe(120);
    expect(clampDecisionBodyHeight(400, 800)).toBe(400);
    expect(clampDecisionBodyHeight(900, 800)).toBe(560);
  });

  it("holds the minimum when the canvas is too short to leave room", () => {
    expect(clampDecisionBodyHeight(300, 300)).toBe(120);
  });

  it("only bounds the bottom when the canvas height is unknown", () => {
    expect(clampDecisionBodyHeight(5000, 0)).toBe(5000);
    expect(clampDecisionBodyHeight(10, 0)).toBe(120);
  });
});

describe("decisionBodyDefaultMaxHeight", () => {
  it("takes 30% of a short canvas, floored at the minimum", () => {
    expect(decisionBodyDefaultMaxHeight(200)).toBe("min(14rem, 120px)");
    expect(decisionBodyDefaultMaxHeight(600)).toBe("min(14rem, 180px)");
  });

  it("is unset when the canvas height is unknown", () => {
    expect(decisionBodyDefaultMaxHeight(0)).toBeUndefined();
  });
});
