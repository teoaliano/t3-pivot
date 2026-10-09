import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { type LayoutNode, parsePivotLayout, serializePivotLayout } from "./pivotLayout.logic";

/**
 * How each Pivot shows on this device: as its chat or in the Pivot view, and the
 * Pivot view's layout tree. Client-side only; it never goes over the WebSocket.
 * The wallpaper is kept apart (see `pivotWallpaper.ts`) so a layout change never
 * rewrites the image.
 */

export type PivotViewMode = "chat" | "pivot";

interface PivotViewStoreState {
  readonly modeByPivotKey: Record<string, PivotViewMode>;
  /** Serialized layout trees, read through `parsePivotLayout`. */
  readonly layoutByPivotKey: Record<string, string>;
  readonly setMode: (pivot: ScopedThreadRef, mode: PivotViewMode) => void;
  readonly setLayout: (pivot: ScopedThreadRef, layout: LayoutNode) => void;
}

export const usePivotViewStore = create<PivotViewStoreState>()(
  persist(
    (set) => ({
      modeByPivotKey: {},
      layoutByPivotKey: {},
      setMode: (pivot, mode) =>
        set((state) => ({
          modeByPivotKey: { ...state.modeByPivotKey, [scopedThreadKey(pivot)]: mode },
        })),
      setLayout: (pivot, layout) =>
        set((state) => ({
          layoutByPivotKey: {
            ...state.layoutByPivotKey,
            [scopedThreadKey(pivot)]: serializePivotLayout(layout),
          },
        })),
    }),
    {
      name: "t3pivot:pivot-view:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        modeByPivotKey: state.modeByPivotKey,
        layoutByPivotKey: state.layoutByPivotKey,
      }),
    },
  ),
);

/** The view a Pivot opens in on this device. Chat until the user picks the Pivot view. */
export const usePivotViewMode = (pivot: ScopedThreadRef | null): PivotViewMode =>
  usePivotViewStore((state) =>
    pivot === null ? "chat" : (state.modeByPivotKey[scopedThreadKey(pivot)] ?? "chat"),
  );

export const usePivotLayout = (pivot: ScopedThreadRef): LayoutNode => {
  const raw = usePivotViewStore((state) => state.layoutByPivotKey[scopedThreadKey(pivot)]);
  // Parsed per raw string, so an unchanged layout keeps its identity across renders.
  return parsedLayouts.get(raw ?? "") ?? cacheLayout(raw ?? "");
};

const parsedLayouts = new Map<string, LayoutNode>();
const cacheLayout = (raw: string) => {
  const layout = parsePivotLayout(raw === "" ? null : raw);
  if (parsedLayouts.size > 64) parsedLayouts.clear();
  parsedLayouts.set(raw, layout);
  return layout;
};
