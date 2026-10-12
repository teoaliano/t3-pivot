import { useAtomValue } from "@effect/atom-react";
import { LayoutDashboardIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { usePivotModeEnvironmentIds } from "../../state/pivot";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";

/**
 * New Pivot: asks which project, like new thread does, through the command
 * palette's "New Pivot in..." picker. Absent where no server runs Pivot mode.
 */
export function SidebarNewPivotButton(props: { onOpen?: () => void }) {
  const pivotEnvironmentIds = usePivotModeEnvironmentIds();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (pivotEnvironmentIds.size === 0) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "pivot.new");
  return (
    <SidebarHeaderIconButton
      label="New Pivot"
      tooltip={shortcut ? `New Pivot (${shortcut})` : "New Pivot"}
      onClick={() => {
        props.onOpen?.();
        openCommandPalette({ open: "new-pivot-in" });
      }}
    >
      <LayoutDashboardIcon />
    </SidebarHeaderIconButton>
  );
}
