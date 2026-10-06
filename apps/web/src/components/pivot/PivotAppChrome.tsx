import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { isNewPivotShortcut, isPivotToggleViewShortcut } from "../../keybindings";
import { useThreadShell } from "../../state/entities";
import { usePivotState } from "../../state/pivot";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { useEnvironmentIds } from "../../state/environments";
import { NewPivotDialogHost, openNewPivotDialog } from "./NewPivotDialog";
import { PivotStateSync } from "./pivotStatesStore";
import { usePivotViewMode, usePivotViewStore } from "./pivotViewStore";

/** The routed thread, and whether it is a Pivot and which view it shows. */
export function useRoutePivot(): {
  readonly ref: ScopedThreadRef | null;
  readonly isPivot: boolean;
  readonly inPivotView: boolean;
} {
  const ref = useParams({ strict: false, select: (params) => resolveThreadRouteRef(params) });
  const state = usePivotState(ref?.environmentId ?? null);
  const mode = usePivotViewMode(ref);
  const isPivot = ref !== null && state?.pivots[ref.threadId] !== undefined;
  return { ref, isPivot, inPivotView: isPivot && mode === "pivot" };
}

/**
 * App-wide Pivot mode wiring: the New Pivot dialog and the two Pivot shortcuts,
 * toggling the routed Pivot's view and starting a Pivot in the routed thread's
 * project.
 */
export function PivotAppChrome() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const environmentIds = useEnvironmentIds();
  const route = useRoutePivot();
  const shell = useThreadShell(route.ref);
  const setMode = usePivotViewStore((store) => store.setMode);
  const routeRef = route.ref;
  const isPivot = route.isPivot;
  const inPivotView = route.inPivotView;
  const projectId = shell?.projectId ?? null;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (routeRef !== null && isPivot && isPivotToggleViewShortcut(event, keybindings)) {
        event.preventDefault();
        setMode(routeRef, inPivotView ? "chat" : "pivot");
        return;
      }
      if (routeRef !== null && projectId !== null && isNewPivotShortcut(event, keybindings)) {
        event.preventDefault();
        openNewPivotDialog({ environmentId: routeRef.environmentId, projectId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inPivotView, isPivot, keybindings, projectId, routeRef, setMode]);

  return (
    <>
      <NewPivotDialogHost />
      {environmentIds.map((environmentId) => (
        <PivotStateSync key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}
