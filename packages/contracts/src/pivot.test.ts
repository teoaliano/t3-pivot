import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { PivotAnswerDecisionInput, PivotDecision } from "./pivot.ts";

const decodeAnswer = Schema.decodeUnknownSync(PivotAnswerDecisionInput);
const encodeDecision = Schema.encodeSync(PivotDecision);
const decodeDecision = Schema.decodeUnknownSync(PivotDecision);

describe("the user's answer to a decision", () => {
  const typed = "  Drop it.\n\nBut log a warning first.  ";

  it("arrives exactly as typed", () => {
    expect(decodeAnswer({ decisionId: "decision-1", answer: typed }).answer).toBe(typed);
  });

  it("refuses an answer that is only whitespace", () => {
    expect(() => decodeAnswer({ decisionId: "decision-1", answer: " \n\t " })).toThrow();
    expect(() => decodeAnswer({ decisionId: "decision-1", answer: "" })).toThrow();
  });

  it("reaches clients exactly as recorded", () => {
    const decision = decodeDecision({
      decisionId: "decision-1",
      pivotThreadId: "pivot-1",
      teammateThreadId: null,
      key: "default",
      openedBy: "pivot",
      summary: "Ship it?",
      openedAt: "2026-10-01T10:00:00.000Z",
      escalation: null,
      escalatedAt: "2026-10-01T10:01:00.000Z",
      userAnswer: typed,
      userAnsweredAt: "2026-10-01T10:02:00.000Z",
      userApproved: null,
      resolution: null,
    });
    expect(decision.userAnswer).toBe(typed);
    expect(encodeDecision(decision).userAnswer).toBe(typed);
  });
});
