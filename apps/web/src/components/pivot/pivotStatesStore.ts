import type { PivotState } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { usePivotState } from "../../state/pivot";

/**
 * Every connected environment's Pivot records in one place, for views that
 * span environments, like the sidebar. Mirrored from each environment's stream.
 */
export const usePivotStatesStore = create<{
  readonly byEnvironment: Readonly<Record<string, PivotState>>;
  readonly set: (environmentId: EnvironmentId, state: PivotState | null) => void;
}>()((set) => ({
  byEnvironment: {},
  set: (environmentId, state) =>
    set((current) => {
      if (state === null) {
        if (!(environmentId in current.byEnvironment)) return current;
        const { [environmentId]: _removed, ...rest } = current.byEnvironment;
        return { byEnvironment: rest };
      }
      return current.byEnvironment[environmentId] === state
        ? current
        : { byEnvironment: { ...current.byEnvironment, [environmentId]: state } };
    }),
}));

export function PivotStateSync(props: { environmentId: EnvironmentId }) {
  const state = usePivotState(props.environmentId);
  const set = usePivotStatesStore((store) => store.set);
  useEffect(() => {
    set(props.environmentId, state);
    return () => set(props.environmentId, null);
  }, [props.environmentId, set, state]);
  return null;
}
