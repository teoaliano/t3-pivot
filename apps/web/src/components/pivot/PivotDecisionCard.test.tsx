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

  it("asks an approval with Accept and Comment and an optional note, without options", () => {
    const markup = render(decision({ escalation: { ...escalation, asksApproval: true } }));

    expect(markup).toContain('data-pivot-decision="approval"');
    expect(markup).toContain("Accept");
    expect(markup).toContain("Comment");
    expect(markup).toContain("Write a comment for the teammate, or accept above");
    expect(markup).toContain('aria-label="Anything to add"');
    expect(markup).not.toContain("aria-pressed");
    expect(markup).not.toContain("Submit answer");
  });

  it("holds Comment until the note has text, while Accept stays available", () => {
    const markup = render(decision({ escalation: { ...escalation, asksApproval: true } }));
    const buttons = markup.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    const comment = buttons.find((button) => button.includes(">Comment<"));
    const accept = buttons.find((button) => button.includes(">Accept<"));

    expect(comment).toContain('disabled=""');
    expect(accept).not.toContain('disabled=""');
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
    expect(markup).toContain("You accepted");
    expect(markup).toContain("“Yes, merge it”");
    expect(markup).toContain("The Pivot is relaying it");
    expect(markup).not.toContain("<textarea");
  });
});
