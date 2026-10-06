import { useAtomValue } from "@effect/atom-react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { LayoutDashboardIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { useProject, useServerConfigs } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { openNewPivotDialog, usePivotProjectReadiness } from "./NewPivotDialog";

/**
 * New Pivot, for the project new threads would go to. Disabled with the reason
 * in a project that cannot host teammates; absent where the server has no Pivot
 * mode.
 */
export function SidebarNewPivotButton(props: { projectRef: ScopedProjectRef | null }) {
  const project = useProject(props.projectRef);
  const configs = useServerConfigs();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const readiness = usePivotProjectReadiness(
    props.projectRef?.environmentId ?? null,
    project?.workspaceRoot ?? null,
  );
  if (props.projectRef === null || project === null) return null;
  const supported =
    configs.get(props.projectRef.environmentId)?.environment.capabilities.pivotMode === true;
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
        if (readiness.ready) openNewPivotDialog(target);
      }}
    >
      <LayoutDashboardIcon />
    </SidebarHeaderIconButton>
  );
}
