import { ChevronDownIcon, ChevronRightIcon, LayoutDashboardIcon } from "lucide-react";

import type { SidebarPivotBadge } from "../sidebar/pivotNesting.logic";
import { Badge } from "../ui/badge";

/**
 * Sits under a Pivot's sidebar row: the Pivot badge, how many decisions it holds
 * for the user, and the toggle for its nested teammates.
 */
export function SidebarPivotStrip(props: {
  badge: SidebarPivotBadge;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { badge } = props;
  const Chevron = props.expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li role="presentation">
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        {badge.teammateCount > 0 ? (
          <Chevron className="size-3" />
        ) : (
          <span aria-hidden className="size-3" />
        )}
        <LayoutDashboardIcon className="size-3" />
        <span>{badge.retired ? "Retired Pivot" : "Pivot"}</span>
        {badge.teammateCount > 0 ? (
          <span>
            · {badge.teammateCount} {badge.teammateCount === 1 ? "teammate" : "teammates"}
          </span>
        ) : null}
        {badge.escalatedDecisions > 0 ? (
          <span className="ml-auto">
            <Badge size="sm" variant="warning">
              {badge.escalatedDecisions} {badge.escalatedDecisions === 1 ? "needs you" : "need you"}
            </Badge>
          </span>
        ) : null}
      </button>
    </li>
  );
}
