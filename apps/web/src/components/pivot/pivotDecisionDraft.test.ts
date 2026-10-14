import { type PivotDecision, PivotDecisionId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";
import { discardClosedDecisionDraft, pivotDecisionDraftTarget } from "./pivotDecisionDraft";

const decision = (overrides: Partial<PivotDecision> = {}): PivotDecision => ({
  decisionId: PivotDecisionId.make("d1"),
  pivotThreadId: ThreadId.make("pivot"),
  teammateThreadId: ThreadId.make("teammate"),
  key: "restart",
  openedBy: "teammate",
  summary: "Restart Homebox?",
  openedAt: "2026-10-09T10:00:00.000Z",
  escalation: null,
  escalatedAt: null,
  userAnswer: null,
  userAnsweredAt: null,
  userApproved: null,
  resolution: null,
  ...overrides,
});

const draftOf = (target: ReturnType<typeof pivotDecisionDraftTarget>) =>
  useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "";

describe("pivot decision answer drafts", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
  });

  it("keeps a typed answer per decision, so it does not leak into another decision", () => {
    const first = pivotDecisionDraftTarget(decision());
    const second = pivotDecisionDraftTarget(decision({ decisionId: PivotDecisionId.make("d2") }));

    useComposerDraftStore.getState().setPrompt(first, "wait until tonight");

    expect(draftOf(first)).toBe("wait until tonight");
    expect(draftOf(second)).toBe("");
  });

  it("keys the draft per Pivot thread as well as per decision", () => {
    const here = pivotDecisionDraftTarget(decision());
    const elsewhere = pivotDecisionDraftTarget(
      decision({ pivotThreadId: ThreadId.make("other-pivot") }),
    );

    expect(here).not.toBe(elsewhere);
  });

  it("keeps the draft of an open decision", () => {
    const open = decision();
    const target = pivotDecisionDraftTarget(open);
    useComposerDraftStore.getState().setPrompt(target, "half typed");

    discardClosedDecisionDraft(open);

    expect(draftOf(target)).toBe("half typed");
  });

  it("discards the draft once the user has answered the decision", () => {
    const answered = decision({
      userAnswer: "Restart now",
      userAnsweredAt: "2026-10-09T10:05:00.000Z",
    });
    const target = pivotDecisionDraftTarget(answered);
    useComposerDraftStore.getState().setPrompt(target, "Restart now");

    discardClosedDecisionDraft(answered);

    expect(draftOf(target)).toBe("");
  });

  it("discards the draft when the decision resolves without the user answering", () => {
    const resolved = decision({
      resolution: {
        kind: "cleared",
        text: "The blocker cleared on its own.",
        closedAt: "2026-10-09T10:05:00.000Z",
      },
    });
    const target = pivotDecisionDraftTarget(resolved);
    useComposerDraftStore.getState().setPrompt(target, "half typed");

    discardClosedDecisionDraft(resolved);

    expect(draftOf(target)).toBe("");
  });
});
