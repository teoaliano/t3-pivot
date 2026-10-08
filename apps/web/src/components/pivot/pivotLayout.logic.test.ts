import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_PIVOT_LAYOUT_PRESET,
  hidePane,
  listPanes,
  movePaneToEdge,
  openTeammatePane,
  parsePivotLayout,
  pivotLayoutPreset,
  resizeSplit,
  serializePivotLayout,
  showPane,
  type LayoutNode,
  type PaneKind,
} from "./pivotLayout.logic";

const pane = (kind: PaneKind, teammate?: ThreadId): LayoutNode =>
  teammate ? { type: "pane", kind, teammate } : { type: "pane", kind };
const row = (sizes: number[], ...children: LayoutNode[]): LayoutNode => ({
  type: "row",
  children,
  sizes,
});
const col = (sizes: number[], ...children: LayoutNode[]): LayoutNode => ({
  type: "col",
  children,
  sizes,
});

const alpha = ThreadId.make("alpha");
const beta = ThreadId.make("beta");

describe("pivotLayoutPreset", () => {
  it("teammates on top with the Pivot chat below", () => {
    expect(pivotLayoutPreset("teammates-top")).toEqual(
      col([0.3, 0.7], pane("teammates"), pane("pivot-chat")),
    );
  });

  it("chat left with teammates right", () => {
    expect(pivotLayoutPreset("chat-left")).toEqual(
      row([0.6, 0.4], pane("pivot-chat"), pane("teammates")),
    );
  });

  it("three columns: chat, teammates, teammate", () => {
    expect(pivotLayoutPreset("three-columns")).toEqual(
      row([0.4, 0.3, 0.3], pane("pivot-chat"), pane("teammates"), pane("teammate")),
    );
  });

  it("chat and teammates on top with preview below", () => {
    expect(pivotLayoutPreset("preview-below")).toEqual(
      col([0.6, 0.4], row([0.6, 0.4], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
  });

  it("returns a fresh tree each call", () => {
    expect(pivotLayoutPreset("chat-left")).not.toBe(pivotLayoutPreset("chat-left"));
  });
});

describe("listPanes", () => {
  it("lists pane kinds depth first, left to right", () => {
    expect(listPanes(pivotLayoutPreset("preview-below"))).toEqual([
      "pivot-chat",
      "teammates",
      "preview",
    ]);
  });
});

describe("hidePane", () => {
  it("lets siblings absorb the hidden size proportionally", () => {
    const tree = row([0.5, 0.25, 0.25], pane("pivot-chat"), pane("teammates"), pane("preview"));
    expect(hidePane(tree, "pivot-chat")).toEqual(
      row([0.5, 0.5], pane("teammates"), pane("preview")),
    );
  });

  it("collapses a split left with one child into that child", () => {
    expect(hidePane(pivotLayoutPreset("teammates-top"), "teammates")).toEqual(pane("pivot-chat"));
  });

  it("collapses nested splits and merges same-direction splits", () => {
    const tree = col(
      [0.5, 0.5],
      row([0.5, 0.5], pane("pivot-chat"), pane("teammates")),
      pane("preview"),
    );
    expect(hidePane(tree, "preview")).toEqual(
      row([0.5, 0.5], pane("pivot-chat"), pane("teammates")),
    );

    const nested = row(
      [0.5, 0.5],
      col([0.5, 0.5], pane("diff"), row([0.5, 0.5], pane("files"), pane("preview"))),
      pane("teammates"),
    );
    expect(hidePane(nested, "diff")).toEqual(
      row([0.25, 0.25, 0.5], pane("files"), pane("preview"), pane("teammates")),
    );
  });

  it("refuses to hide the last pane", () => {
    const tree = pane("pivot-chat");
    expect(hidePane(tree, "pivot-chat")).toBe(tree);
  });

  it("leaves the tree unchanged when the pane is not shown", () => {
    const tree = pivotLayoutPreset("chat-left");
    expect(hidePane(tree, "diff")).toBe(tree);
  });
});

describe("showPane", () => {
  it("puts the pane on the right edge, wrapping a single pane in a row", () => {
    expect(showPane(pane("pivot-chat"), "teammates")).toEqual(
      row([2 / 3, 1 / 3], pane("pivot-chat"), pane("teammates")),
    );
  });

  it("wraps a column root in a row and gives the new pane a third", () => {
    expect(showPane(pivotLayoutPreset("teammates-top"), "preview")).toEqual(
      row([2 / 3, 1 / 3], col([0.3, 0.7], pane("teammates"), pane("pivot-chat")), pane("preview")),
    );
  });

  it("joins a row root with an equal share", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("teammates"));
    expect(showPane(tree, "diff")).toEqual(
      row([1 / 3, 1 / 3, 1 / 3], pane("pivot-chat"), pane("teammates"), pane("diff")),
    );
  });

  it("does nothing when the pane is already shown", () => {
    const tree = pivotLayoutPreset("chat-left");
    expect(showPane(tree, "teammates")).toBe(tree);
  });
});

describe("movePaneToEdge", () => {
  it("moves a pane to the top, wrapping the rest in a column", () => {
    const tree = row([0.6, 0.4], pane("pivot-chat"), pane("teammates"));
    expect(movePaneToEdge(tree, "teammates", "top")).toEqual(
      col([1 / 3, 2 / 3], pane("teammates"), pane("pivot-chat")),
    );
  });

  it("moves a pane to the bottom", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("teammates"));
    expect(movePaneToEdge(tree, "pivot-chat", "bottom")).toEqual(
      col([2 / 3, 1 / 3], pane("teammates"), pane("pivot-chat")),
    );
  });

  it("moves a pane to the left", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("teammates"));
    expect(movePaneToEdge(tree, "teammates", "left")).toEqual(
      row([1 / 3, 2 / 3], pane("teammates"), pane("pivot-chat")),
    );
  });

  it("joins a root split that already runs in that direction", () => {
    const tree = row(
      [0.5, 0.5],
      pane("pivot-chat"),
      col([0.5, 0.5], pane("teammates"), pane("preview")),
    );
    expect(movePaneToEdge(tree, "preview", "left")).toEqual(
      row([1 / 3, 1 / 3, 1 / 3], pane("preview"), pane("pivot-chat"), pane("teammates")),
    );
  });

  it("wraps the collapsed remainder, not the old structure", () => {
    const tree = col(
      [0.6, 0.4],
      row([0.5, 0.5], pane("pivot-chat"), pane("teammates")),
      pane("preview"),
    );
    expect(movePaneToEdge(tree, "preview", "right")).toEqual(
      row(
        [0.5 * (2 / 3), 0.5 * (2 / 3), 1 / 3],
        pane("pivot-chat"),
        pane("teammates"),
        pane("preview"),
      ),
    );
  });

  it("keeps the pane's teammate", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("diff", alpha));
    expect(movePaneToEdge(tree, "diff", "top")).toEqual(
      col([1 / 3, 2 / 3], pane("diff", alpha), pane("pivot-chat")),
    );
  });

  it("leaves a lone pane and an absent pane alone", () => {
    const lone = pane("pivot-chat");
    expect(movePaneToEdge(lone, "pivot-chat", "left")).toBe(lone);
    const tree = pivotLayoutPreset("chat-left");
    expect(movePaneToEdge(tree, "diff", "left")).toBe(tree);
  });
});

describe("resizeSplit", () => {
  const tree = col(
    [0.5, 0.5],
    row([0.5, 0.5], pane("pivot-chat"), pane("teammates")),
    pane("preview"),
  );

  it("sets the sizes of the root split", () => {
    expect(resizeSplit(tree, [], [0.25, 0.75])).toEqual(
      col([0.25, 0.75], row([0.5, 0.5], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
  });

  it("sets the sizes of a nested split by child-index path", () => {
    expect(resizeSplit(tree, [0], [0.75, 0.25])).toEqual(
      col([0.5, 0.5], row([0.75, 0.25], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
  });

  it("normalizes sizes to sum to 1", () => {
    expect(resizeSplit(tree, [], [1, 3])).toEqual(
      col([0.25, 0.75], row([0.5, 0.5], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
  });

  it("keeps every pane at the minimum size", () => {
    expect(resizeSplit(tree, [], [0.99, 0.01])).toEqual(
      col([0.95, 0.05], row([0.5, 0.5], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
    expect(resizeSplit(tree, [0], [0, 1])).toEqual(
      col([0.5, 0.5], row([0.05, 0.95], pane("pivot-chat"), pane("teammates")), pane("preview")),
    );
  });

  it("ignores a bad path, a pane target, or the wrong number of sizes", () => {
    expect(resizeSplit(tree, [5], [0.5, 0.5])).toBe(tree);
    expect(resizeSplit(tree, [1], [0.5, 0.5])).toBe(tree);
    expect(resizeSplit(tree, [], [1])).toBe(tree);
    expect(resizeSplit(tree, [], [Number.NaN, 1])).toBe(tree);
  });
});

describe("openTeammatePane", () => {
  it("opens the pane for the teammate when it is not open", () => {
    expect(openTeammatePane(pane("pivot-chat"), "diff", alpha)).toEqual(
      row([2 / 3, 1 / 3], pane("pivot-chat"), pane("diff", alpha)),
    );
  });

  it("switches an open pane of that kind to the teammate", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("teammate", alpha));
    expect(openTeammatePane(tree, "teammate", beta)).toEqual(
      row([0.5, 0.5], pane("pivot-chat"), pane("teammate", beta)),
    );
  });

  it("only changes the pane of the requested kind", () => {
    const tree = row([0.5, 0.5], pane("teammate", alpha), pane("diff", alpha));
    expect(openTeammatePane(tree, "diff", beta)).toEqual(
      row([0.5, 0.5], pane("teammate", alpha), pane("diff", beta)),
    );
  });

  it("returns the same tree when the pane already shows that teammate", () => {
    const tree = row([0.5, 0.5], pane("pivot-chat"), pane("teammate", alpha));
    expect(openTeammatePane(tree, "teammate", alpha)).toBe(tree);
  });
});

describe("serializePivotLayout / parsePivotLayout", () => {
  it("round-trips a tree", () => {
    const tree = col(
      [0.3, 0.7],
      row([0.5, 0.5], pane("teammates"), pane("diff", alpha)),
      pane("pivot-chat"),
    );
    expect(parsePivotLayout(serializePivotLayout(tree))).toEqual(tree);
  });

  const fallback = pivotLayoutPreset(DEFAULT_PIVOT_LAYOUT_PRESET);
  const stored = (tree: unknown) => JSON.stringify({ version: 1, tree });

  it("falls back to the default preset for missing or unparsable storage", () => {
    expect(parsePivotLayout(null)).toEqual(fallback);
    expect(parsePivotLayout("")).toEqual(fallback);
    expect(parsePivotLayout("{not json")).toEqual(fallback);
  });

  it("falls back for another version or shape", () => {
    expect(parsePivotLayout(JSON.stringify({ version: 2, tree: pane("pivot-chat") }))).toEqual(
      fallback,
    );
    expect(parsePivotLayout(JSON.stringify(pane("pivot-chat")))).toEqual(fallback);
    expect(parsePivotLayout("null")).toEqual(fallback);
  });

  it("falls back for unknown pane kinds and unknown node types", () => {
    expect(parsePivotLayout(stored({ type: "pane", kind: "terminal" }))).toEqual(fallback);
    expect(parsePivotLayout(stored({ type: "grid", children: [], sizes: [] }))).toEqual(fallback);
  });

  it("falls back for splits with fewer than two children or mismatched sizes", () => {
    expect(parsePivotLayout(stored(row([1], pane("pivot-chat"))))).toEqual(fallback);
    expect(parsePivotLayout(stored(row([1], pane("pivot-chat"), pane("teammates"))))).toEqual(
      fallback,
    );
    expect(parsePivotLayout(stored(row([0, 1], pane("pivot-chat"), pane("teammates"))))).toEqual(
      fallback,
    );
    expect(parsePivotLayout(stored(row([-1, 2], pane("pivot-chat"), pane("teammates"))))).toEqual(
      fallback,
    );
  });

  it("falls back when a pane kind appears twice", () => {
    expect(
      parsePivotLayout(stored(row([0.5, 0.5], pane("diff", alpha), pane("diff", beta)))),
    ).toEqual(fallback);
  });

  it("falls back for a blank teammate id", () => {
    expect(parsePivotLayout(stored({ type: "pane", kind: "diff", teammate: "" }))).toEqual(
      fallback,
    );
  });

  it("drops a teammate from a pane kind that has none", () => {
    expect(
      parsePivotLayout(stored({ type: "pane", kind: "pivot-chat", teammate: "alpha" })),
    ).toEqual(pane("pivot-chat"));
  });

  it("rescales sizes that do not sum to 1 and ignores extra fields", () => {
    expect(
      parsePivotLayout(
        stored({
          type: "row",
          extra: true,
          sizes: [1, 3],
          children: [
            { type: "pane", kind: "pivot-chat", width: 10 },
            { type: "pane", kind: "teammates" },
          ],
        }),
      ),
    ).toEqual(row([0.25, 0.75], pane("pivot-chat"), pane("teammates")));
  });

  it("accepts a single pane", () => {
    expect(parsePivotLayout(stored(pane("files")))).toEqual(pane("files"));
  });
});
