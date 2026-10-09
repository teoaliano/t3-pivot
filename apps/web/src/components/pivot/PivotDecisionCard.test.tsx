import { type PivotDecision, PivotDecisionId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PivotDecisionCard } from "./PivotDecisionCard";

const escalation = {
  questions: ["Rebuild and restart the T3 server on Homebox now?"] as const,
  evidence: "The build on main passed.",
  consequence: "Restarting drops live sessions for 20 seconds.",
  options: ["Restart now", "Wait until tonight"],
  recommendation: "Restart now, nothing is running.",
};

const decision = (overrides: Partial<PivotDecision> = {}): PivotDecision => ({
  decisionId: PivotDecisionId.make("d1"),
  pivotThreadId: ThreadId.make("pivot"),
  teammateThreadId: ThreadId.make("teammate"),
  key: "restart",
  openedBy: "teammate",
  summary: "Restart Homebox?",
  openedAt: "2026-10-09T10:00:00.000Z",
  escalation,
  escalatedAt: "2026-10-09T10:01:00.000Z",
  userAnswer: null,
  userAnsweredAt: null,
  userApproved: null,
  resolution: null,
  ...overrides,
});

const render = (value: PivotDecision) =>
  renderToStaticMarkup(
    <PivotDecisionCard
      decision={value}
      asker="Homebox deploy"
      position={{ index: 0, total: 2 }}
      sending={false}
      onAnswer={() => {}}
    />,
  );

describe("PivotDecisionCard", () => {
  it("asks an open question with its options, marking the recommended one", () => {
    const markup = render(decision());

    expect(markup).toContain('data-pivot-decision="question"');
    expect(markup).toContain("Homebox deploy asks");
    expect(markup).toContain("1/2");
    expect(markup).toContain(escalation.evidence);
    expect(markup).not.toContain("Evidence:");
    const recommended = markup.match(/<button[^>]*aria-pressed[^>]*>.*?<\/button>/g) ?? [];
    expect(recommended).toHaveLength(2);
    expect(recommended[0]).toContain("Recommended");
    expect(recommended[1]).not.toContain("Recommended");
    expect(markup).toContain('aria-label="Your answer"');
    expect(markup).toContain("Submit answer");
  });

  it("keeps a recommendation that names no option as its own line", () => {
    const markup = render(
      decision({ escalation: { ...escalation, recommendation: "Ask Theo first." } }),
    );

    expect(markup).toContain("Recommended: Ask Theo first.");
    expect(markup).not.toContain(">Recommended<");
  });

  it("asks an approval with Decline and Approve and an optional note, without options", () => {
    const markup = render(decision({ escalation: { ...escalation, asksApproval: true } }));

    expect(markup).toContain('data-pivot-decision="approval"');
    expect(markup).toContain("Decline");
    expect(markup).toContain("Approve");
    expect(markup).toContain('aria-label="Anything to add"');
    expect(markup).not.toContain("aria-pressed");
    expect(markup).not.toContain("Submit answer");
  });

  it("shrinks an answered decision to one row with the user's words and no input", () => {
    const markup = render(
      decision({
        userAnswer: "Yes, merge it",
        userApproved: true,
        userAnsweredAt: "2026-10-09T10:05:00.000Z",
      }),
    );

    expect(markup).toContain('data-pivot-decision="answered"');
    expect(markup).toContain("You approved");
    expect(markup).toContain("“Yes, merge it”");
    expect(markup).toContain("The Pivot is relaying it");
    expect(markup).not.toContain("<textarea");
  });
});
