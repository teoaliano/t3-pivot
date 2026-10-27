import { type PivotDecision, PivotDecisionId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PivotDecisionCard } from "./PivotDecisionCard";

const approval = (id: string): PivotDecision => ({
  decisionId: PivotDecisionId.make(id),
  pivotThreadId: ThreadId.make("pivot"),
  teammateThreadId: ThreadId.make("teammate"),
  key: id,
  openedBy: "teammate",
  summary: "Merge the PR?",
  openedAt: "2026-10-09T10:00:00.000Z",
  escalation: {
    questions: ["Merge https://github.com/teoaliano/t3-pivot/pull/18?"],
    evidence: "Checks pass.",
    consequence: "It lands on main.",
    options: [],
    recommendation: "Merge it.",
    asksApproval: true,
  },
  escalatedAt: "2026-10-09T10:01:00.000Z",
  userAnswer: null,
  userAnsweredAt: null,
  userApproved: null,
  resolution: null,
});

let root: Root;
let container: HTMLDivElement;
const onAnswer = vi.fn();

const mount = (decision: PivotDecision) =>
  act(async () =>
    root.render(
      <PivotDecisionCard
        decision={decision}
        asker="Sidebar Pivot row"
        position={{ index: 0, total: 2 }}
        sending={false}
        onAnswer={onAnswer}
      />,
    ),
  );
const unmount = () => act(async () => root.unmount());

const byDecision = (kind: string) =>
  container.querySelectorAll<HTMLElement>(`[data-pivot-decision="${kind}"]`);
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"], button[title="${label}"]`,
  )!;
/** Whether the expanded box is shown: it stays mounted under a hidden wrapper when minimized. */
const expandedShown = () => {
  const wrapper = container.querySelector<HTMLElement>(
    `div:has(> [data-pivot-decision="approval"])`,
  );
  expect(wrapper).not.toBeNull();
  return !wrapper!.hidden;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAnswer.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.unstubAllGlobals();
});

describe("PivotDecisionCard minimize", () => {
  it("minimizes to one pending row and expands again without answering", async () => {
    await mount(approval("minimize-1"));
    expect(expandedShown()).toBe(true);
    expect(byDecision("minimized")).toHaveLength(0);

    await act(async () => button("Minimize").click());
    const row = byDecision("minimized");
    expect(row).toHaveLength(1);
    expect(expandedShown()).toBe(false);
    const text = row[0]!.textContent ?? "";
    expect(text).toContain("Approval");
    expect(text).toContain("1/2");

    await act(async () => button("Expand").click());
    expect(byDecision("minimized")).toHaveLength(0);
    expect(expandedShown()).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("remembers a minimized decision for the session, while a new one opens expanded", async () => {
    await mount(approval("minimize-2"));
    await act(async () => button("Minimize").click());
    await unmount();

    root = createRoot(container);
    await mount(approval("minimize-2"));
    expect(byDecision("minimized")).toHaveLength(1);
    await unmount();

    root = createRoot(container);
    await mount(approval("minimize-3"));
    expect(byDecision("minimized")).toHaveLength(0);
  });
});
