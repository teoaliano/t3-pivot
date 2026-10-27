import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isNewPivotShortcut } from "../../keybindings";
import { usePivotModeEnvironmentIds } from "../../state/pivot";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentIds } from "../../state/environments";
import { NewPivotHost } from "./NewPivot";
import { PivotStateSync } from "./pivotStatesStore";

/**
 * App-wide Pivot mode wiring: the New Pivot dialog and the shortcut that opens the
 * "New Pivot in..." picker.
 */
export function PivotAppChrome() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const environmentIds = useEnvironmentIds();
  const pivotEnvironmentIds = usePivotModeEnvironmentIds();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (pivotEnvironmentIds.size > 0 && isNewPivotShortcut(event, keybindings)) {
        event.preventDefault();
        openCommandPalette({ open: "new-pivot-in" });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [keybindings, pivotEnvironmentIds]);

  return (
    <>
      <NewPivotHost />
      {environmentIds.map((environmentId) => (
        <PivotStateSync key={environmentId} environmentId={environmentId} />
      ))}
    </>
  );
}
