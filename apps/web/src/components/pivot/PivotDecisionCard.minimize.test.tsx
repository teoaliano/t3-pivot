import { type PivotDecision, PivotDecisionId, ThreadId } from "@t3tools/contracts";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
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

let renderer: ReactTestRenderer | undefined;
const onAnswer = vi.fn();

const mount = (decision: PivotDecision) => {
  act(() => {
    renderer = create(
      <PivotDecisionCard
        decision={decision}
        asker="Sidebar Pivot row"
        position={{ index: 0, total: 2 }}
        sending={false}
        onAnswer={onAnswer}
      />,
    );
  });
  return renderer!;
};

const byDecision = (root: ReactTestInstance, kind: string) =>
  root.findAll(
    (node) => typeof node.type === "string" && node.props["data-pivot-decision"] === kind,
  );
const button = (root: ReactTestInstance, label: string) =>
  root.find(
    (node) =>
      node.type === "button" && (node.props["aria-label"] === label || node.props.title === label),
  );
/** The strings a subtree renders, in order. */
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
/** Whether the expanded box is shown: it stays mounted under a hidden wrapper when minimized. */
const expandedShown = (root: ReactTestInstance) => {
  const wrapper = root.find((node) => node.type === "div" && "hidden" in node.props);
  expect(byDecision(wrapper, "approval")).toHaveLength(1);
  return wrapper.props.hidden !== true;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAnswer.mockReset();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("PivotDecisionCard minimize", () => {
  it("minimizes to one pending row and expands again without answering", () => {
    const root = mount(approval("minimize-1")).root;
    expect(expandedShown(root)).toBe(true);
    expect(byDecision(root, "minimized")).toHaveLength(0);

    act(() => button(root, "Minimize").props.onClick());
    const row = byDecision(root, "minimized");
    expect(row).toHaveLength(1);
    expect(expandedShown(root)).toBe(false);
    const text = textOf(row[0]!);
    expect(text).toContain("Approval");
    expect(text).toContain("1/2");

    act(() => button(root, "Expand").props.onClick());
    expect(byDecision(root, "minimized")).toHaveLength(0);
    expect(expandedShown(root)).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("remembers a minimized decision for the session, while a new one opens expanded", () => {
    const first = mount(approval("minimize-2")).root;
    act(() => button(first, "Minimize").props.onClick());
    act(() => renderer?.unmount());

    expect(byDecision(mount(approval("minimize-2")).root, "minimized")).toHaveLength(1);
    act(() => renderer?.unmount());
    expect(byDecision(mount(approval("minimize-3")).root, "minimized")).toHaveLength(0);
  });
});
