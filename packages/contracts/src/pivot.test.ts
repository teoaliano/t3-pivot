import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  PIVOT_HOST_DISPATCH_ID_MAX_LENGTH,
  PIVOT_HOST_LABEL_MAX_LENGTH,
  PIVOT_HOST_TEXT_MAX_LENGTH,
  PIVOT_HOST_TITLE_MAX_LENGTH,
  PivotAnswerDecisionInput,
  PivotDecision,
  PivotHostLaunchInput,
  PivotHostSendInput,
} from "./pivot.ts";

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

describe("what a host link's session may send", () => {
  const decodeLaunch = Schema.decodeUnknownExit(PivotHostLaunchInput);
  const launch = {
    homeEnvironmentId: "environment-home",
    dispatchId: "dispatch-1",
    projectId: "project-1",
    pivotThreadId: "pivot-1",
    pivotLabel: "Pivot on Mac",
    title: "Fix the login bug",
    kind: "ship",
    intent: "Make the login button work.",
    spec: "Reproduce, fix, test.",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  };
  const accepted = (overrides: object) =>
    decodeLaunch({ ...launch, ...overrides })._tag === "Success";

  it("bounds every free-text field", () => {
    expect(accepted({})).toBe(true);
    expect(accepted({ title: "t".repeat(PIVOT_HOST_TITLE_MAX_LENGTH) })).toBe(true);
    expect(accepted({ title: "t".repeat(PIVOT_HOST_TITLE_MAX_LENGTH + 1) })).toBe(false);
    expect(accepted({ pivotLabel: "l".repeat(PIVOT_HOST_LABEL_MAX_LENGTH + 1) })).toBe(false);
    expect(accepted({ dispatchId: "d".repeat(PIVOT_HOST_DISPATCH_ID_MAX_LENGTH + 1) })).toBe(false);
    expect(accepted({ intent: "i".repeat(PIVOT_HOST_TEXT_MAX_LENGTH + 1) })).toBe(false);
    expect(accepted({ spec: "s".repeat(PIVOT_HOST_TEXT_MAX_LENGTH + 1) })).toBe(false);
    expect(
      Schema.decodeUnknownExit(PivotHostSendInput)({
        homeEnvironmentId: "environment-home",
        threadId: "thread-1",
        text: "x".repeat(PIVOT_HOST_TEXT_MAX_LENGTH + 1),
      })._tag,
    ).toBe("Failure");
  });

  it("takes a base branch only when it reads as a ref name", () => {
    for (const baseBranch of ["main", "pivot/other", "release/1.2-rc.1", "feature_x"]) {
      expect(accepted({ baseBranch }), baseBranch).toBe(true);
    }
    for (const baseBranch of [
      "--upload-pack=evil",
      "-rf",
      "a..b",
      "a b",
      "main.lock",
      "x/",
      "/x",
      "a//b",
      ".hidden",
      "a/.b",
      "a@{1}",
      "x".repeat(300),
    ]) {
      expect(accepted({ baseBranch }), baseBranch).toBe(false);
    }
  });
});
