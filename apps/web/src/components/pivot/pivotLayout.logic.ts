import { ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * The Pivot view's layout: a tree of row and column splits holding panes. The tree is the
 * only layout state, so anything that changes the layout (menus, dividers, later
 * drag-and-drop docking) is a function from tree to tree.
 *
 * Invariants every function here keeps:
 * - a pane kind appears at most once;
 * - a split has two or more children and one size per child, each size positive and all
 *   summing to 1;
 * - a split never directly contains a split of the same direction;
 * - at least one pane exists.
 *
 * Each function returns its input (same reference) when it has nothing to change.
 */

export type PaneKind =
  | "pivot-chat"
  | "teammates"
  | "decisions"
  | "teammate"
  | "preview"
  | "files"
  | "diff";

export type LayoutNode =
  | {
      type: "pane";
      kind: PaneKind;
      teammate?: ThreadId;
      /**
       * The user dragged this pane's height. Until then, the teammate cards in a column
       * size to their wrapped rows instead of taking their share.
       */
      sized?: true;
    }
  | { type: "row" | "col"; children: LayoutNode[]; sizes: number[] };

type SplitNode = Extract<LayoutNode, { type: "row" | "col" }>;
type PaneNode = Extract<LayoutNode, { type: "pane" }>;

export type PivotLayoutEdge = "top" | "bottom" | "left" | "right";

/** Panes that show one teammate's material. */
export type TeammatePaneKind = "teammate" | "preview" | "files" | "diff";

const PANE_KINDS: readonly PaneKind[] = [
  "pivot-chat",
  "teammates",
  "decisions",
  "teammate",
  "preview",
  "files",
  "diff",
];
const TEAMMATE_PANE_KINDS: ReadonlySet<PaneKind> = new Set<PaneKind>([
  "teammate",
  "preview",
  "files",
  "diff",
]);

/** Smallest share of a split a pane can be resized to. */
export const MIN_PANE_SIZE = 0.05;

const isThreadId = Schema.is(ThreadId);
const isPaneKind = (value: unknown): value is PaneKind => PANE_KINDS.some((kind) => kind === value);
const isTeammatePaneKind = (kind: PaneKind): kind is TeammatePaneKind =>
  TEAMMATE_PANE_KINDS.has(kind);

// --- Presets ---------------------------------------------------------------------------

const leaf = (kind: PaneKind): LayoutNode => ({ type: "pane", kind });

const PRESETS = {
  "teammates-top": (): LayoutNode => ({
    type: "col",
    children: [leaf("teammates"), leaf("pivot-chat")],
    sizes: [0.2, 0.8],
  }),
  "chat-left": (): LayoutNode => ({
    type: "row",
    children: [leaf("pivot-chat"), leaf("teammates")],
    sizes: [0.6, 0.4],
  }),
  "three-columns": (): LayoutNode => ({
    type: "row",
    children: [leaf("pivot-chat"), leaf("teammates"), leaf("teammate")],
    sizes: [0.4, 0.3, 0.3],
  }),
  "preview-below": (): LayoutNode => ({
    type: "col",
    children: [
      {
        type: "row",
        children: [leaf("pivot-chat"), leaf("teammates")],
        sizes: [0.6, 0.4],
      },
      leaf("preview"),
    ],
    sizes: [0.6, 0.4],
  }),
};

export type PivotLayoutPreset = keyof typeof PRESETS;

export const PIVOT_LAYOUT_PRESETS = Object.keys(PRESETS) as PivotLayoutPreset[];

/** What a Pivot starts with, and what a bad stored tree falls back to. */
export const DEFAULT_PIVOT_LAYOUT_PRESET: PivotLayoutPreset = "teammates-top";

export const pivotLayoutPreset = (preset: PivotLayoutPreset): LayoutNode => PRESETS[preset]();

// --- Reading ---------------------------------------------------------------------------

/** Pane kinds in the tree, depth first, left to right. */
export function listPanes(node: LayoutNode): PaneKind[] {
  return node.type === "pane" ? [node.kind] : node.children.flatMap(listPanes);
}

function findPane(node: LayoutNode, kind: PaneKind): PaneNode | null {
  if (node.type === "pane") return node.kind === kind ? node : null;
  for (const child of node.children) {
    const found = findPane(child, kind);
    if (found) return found;
  }
  return null;
}

// --- Structural helpers ----------------------------------------------------------------

const scale = (sizes: readonly number[], factor: number) => sizes.map((size) => size * factor);

/**
 * Builds a split from children and relative weights: weights are rescaled to sum to 1, a
 * single child collapses to itself, and children that split the same way are spliced in.
 */
function makeSplit(
  type: SplitNode["type"],
  children: readonly LayoutNode[],
  weights: readonly number[],
): LayoutNode {
  if (children.length === 1) return children[0]!;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const flatChildren: LayoutNode[] = [];
  const flatSizes: number[] = [];
  children.forEach((child, index) => {
    const size = weights[index]! / total;
    if (child.type === type) {
      flatChildren.push(...child.children);
      flatSizes.push(...scale(child.sizes, size));
    } else {
      flatChildren.push(child);
      flatSizes.push(size);
    }
  });
  return { type, children: flatChildren, sizes: flatSizes };
}

function withoutPane(node: LayoutNode, kind: PaneKind): LayoutNode | null {
  if (node.type === "pane") return node.kind === kind ? null : node;
  const children: LayoutNode[] = [];
  const weights: number[] = [];
  node.children.forEach((child, index) => {
    const kept = withoutPane(child, kind);
    if (kept) {
      children.push(kept);
      weights.push(node.sizes[index]!);
    }
  });
  if (children.length === 0) return null;
  return makeSplit(node.type, children, weights);
}

/**
 * Wraps the whole view in a split with `pane` on `edge`. Joins the root split instead of
 * nesting when it already runs that way. The new pane takes an equal share of a joined
 * root, or a third of a fresh split.
 */
function addAtEdge(root: LayoutNode, pane: PaneNode, edge: PivotLayoutEdge): LayoutNode {
  const type = edge === "left" || edge === "right" ? "row" : "col";
  const first = edge === "left" || edge === "top";
  const count = root.type === type ? root.children.length : 2;
  const existing = root.type === type ? root.sizes : [1];
  const children = root.type === type ? root.children : [root];
  const kept = scale(existing, count / (count + 1));
  const added = 1 / (count + 1);
  return makeSplit(
    type,
    first ? [pane, ...children] : [...children, pane],
    first ? [added, ...kept] : [...kept, added],
  );
}

// --- Operations ------------------------------------------------------------------------

/**
 * Hides a pane; its siblings absorb its size in proportion. Refuses to hide the last pane.
 */
export function hidePane(root: LayoutNode, kind: PaneKind): LayoutNode {
  if (!findPane(root, kind)) return root;
  return withoutPane(root, kind) ?? root;
}

/**
 * Brings a hidden pane back on the right edge of the whole view, a new column beside
 * everything else. One predictable place beats guessing a neighbor, and the user can move
 * it from the pane's menu.
 */
export function showPane(root: LayoutNode, kind: PaneKind): LayoutNode {
  if (findPane(root, kind)) return root;
  return addAtEdge(root, { type: "pane", kind }, "right");
}

/** Moves a pane to an edge of the whole view, keeping its teammate. */
export function movePaneToEdge(
  root: LayoutNode,
  kind: PaneKind,
  edge: PivotLayoutEdge,
): LayoutNode {
  const pane = findPane(root, kind);
  const rest = pane ? withoutPane(root, kind) : null;
  if (!pane || !rest) return root;
  return addAtEdge(rest, pane, edge);
}

/**
 * Sets the sizes of the split reached by `path` (child indexes from the root; `[]` is the
 * root). Sizes are normalized to sum to 1 and no pane goes below `MIN_PANE_SIZE`.
 */
export function resizeSplit(
  root: LayoutNode,
  path: readonly number[],
  sizes: readonly number[],
): LayoutNode {
  if (path.length === 0) {
    if (root.type === "pane" || sizes.length !== root.children.length) return root;
    const next = clampSizes(sizes);
    if (!next) return root;
    // Resizing a column fixes the cards' height there from now on.
    const children =
      root.type === "col"
        ? root.children.map((child) =>
            child.type === "pane" && child.kind === "teammates" && child.sized !== true
              ? { ...child, sized: true as const }
              : child,
          )
        : root.children;
    return { ...root, children, sizes: next };
  }
  if (root.type === "pane") return root;
  const [index, ...rest] = path;
  const child = root.children[index!];
  if (!child) return root;
  const resized = resizeSplit(child, rest, sizes);
  if (resized === child) return root;
  return { ...root, children: root.children.map((c) => (c === child ? resized : c)) };
}

/**
 * Normalizes sizes to sum to 1 with every size at least the minimum. Sizes below the
 * minimum are pinned to it and the rest share what is left, repeating until stable.
 */
function clampSizes(sizes: readonly number[]): number[] | null {
  if (sizes.some((size) => !Number.isFinite(size) || size < 0)) return null;
  const min = Math.min(MIN_PANE_SIZE, 1 / sizes.length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return null;
  let result = sizes.map((size) => size / total);
  const pinned = new Set<number>();
  for (;;) {
    const low = result.findIndex((size, index) => !pinned.has(index) && size < min);
    if (low === -1) return result;
    pinned.add(low);
    const free = result.reduce((sum, size, index) => (pinned.has(index) ? sum : sum + size), 0);
    const room = 1 - pinned.size * min;
    result = result.map((size, index) => (pinned.has(index) ? min : (size / free) * room));
  }
}

/**
 * Opens a teammate-bound pane for a teammate: switches the pane of that kind if one is
 * open, otherwise shows it (right edge, see `showPane`). There is no separate focus state.
 */
export function openTeammatePane(
  root: LayoutNode,
  kind: TeammatePaneKind,
  teammate: ThreadId,
): LayoutNode {
  const open = findPane(root, kind);
  if (!open) return addAtEdge(root, { type: "pane", kind, teammate }, "right");
  if (open.teammate === teammate) return root;
  const bind = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") return node === open ? { ...node, teammate } : node;
    return { ...node, children: node.children.map(bind) };
  };
  return bind(root);
}

// --- Storage ---------------------------------------------------------------------------

const STORAGE_VERSION = 1;

export const serializePivotLayout = (root: LayoutNode): string =>
  JSON.stringify({ version: STORAGE_VERSION, tree: root });

/**
 * Reads a stored layout. Anything malformed, from another version, or breaking the tree
 * invariants falls back to the default preset rather than being repaired.
 */
export function parsePivotLayout(raw: string | null | undefined): LayoutNode {
  const tree = raw ? readStored(raw) : null;
  return tree ?? pivotLayoutPreset(DEFAULT_PIVOT_LAYOUT_PRESET);
}

function readStored(raw: string): LayoutNode | null {
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(stored) || stored.version !== STORAGE_VERSION) return null;
  const tree = readNode(stored.tree);
  if (!tree) return null;
  const kinds = listPanes(tree);
  return new Set(kinds).size === kinds.length ? tree : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readNode(value: unknown): LayoutNode | null {
  if (!isRecord(value)) return null;
  if (value.type === "pane") return readPane(value);
  if (value.type !== "row" && value.type !== "col") return null;
  const { children, sizes } = value;
  if (!Array.isArray(children) || !Array.isArray(sizes)) return null;
  if (children.length < 2 || sizes.length !== children.length) return null;
  if (!sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0)) {
    return null;
  }
  const nodes = children.map(readNode);
  if (nodes.some((node) => node === null)) return null;
  return makeSplit(value.type, nodes as LayoutNode[], sizes as number[]);
}

function readPane(value: Record<string, unknown>): LayoutNode | null {
  const { kind, teammate } = value;
  if (!isPaneKind(kind)) return null;
  if (kind === "teammates" && value.sized === true) return { type: "pane", kind, sized: true };
  if (!isTeammatePaneKind(kind) || teammate === undefined) return { type: "pane", kind };
  return isThreadId(teammate) ? { type: "pane", kind, teammate } : null;
}
