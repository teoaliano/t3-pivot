import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { LayoutDashboardIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { useProject } from "../../state/entities";
import { usePivotModeSupported } from "../../state/pivot";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { startNewPivot, usePivotProjectReadiness } from "./NewPivot";

/**
 * New Pivot, for the project new threads would go to. Disabled with the reason
 * in a project that cannot host teammates; absent where the server has no Pivot
 * mode.
 */
export function SidebarNewPivotButton(props: { projectRef: ScopedProjectRef | null }) {
  const project = useProject(props.projectRef);
  const supported = usePivotModeSupported(props.projectRef?.environmentId ?? null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const readiness = usePivotProjectReadiness(
    props.projectRef?.environmentId ?? null,
    project?.workspaceRoot ?? null,
  );
  if (props.projectRef === null || project === null) return null;
  if (!supported) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "pivot.new");
  const label = `New Pivot in ${project.title}${shortcut ? ` (${shortcut})` : ""}`;
  const target = { environmentId: props.projectRef.environmentId, projectId: project.id };
  return (
    <SidebarHeaderIconButton
      label="New Pivot"
      tooltip={readiness.reason ?? label}
      aria-disabled={!readiness.ready || undefined}
      onClick={() => {
        if (readiness.ready) startNewPivot(target);
      }}
    >
      <LayoutDashboardIcon />
    </SidebarHeaderIconButton>
  );
}
