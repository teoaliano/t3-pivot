import { LayoutDashboardIcon } from "lucide-react";

import type { SidebarPivotGroup } from "../sidebar/pivotNesting.logic";
import { pivotGroupHasTeammates } from "../sidebar/pivotNesting.logic";
import type { SidebarStatusIconKind } from "../sidebar/SidebarStatusIcon";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { TeammateCard } from "./pivotCards.logic";

/**
 * The last line of a Pivot's sidebar row: how many teammates it has and how many need
 * the user. Its teammates live in the Pivot's right panel, not the sidebar. The row
 * itself opens the Pivot. A Pivot with nothing to count leaves the line empty, apart
 * from "Retired".
 */
export function SidebarPivotSummary(props: { group: SidebarPivotGroup }) {
  const { group } = props;
  const count = group.teammates.length;
  // Only the numbers show; the words stay in tooltips and for screen readers.
  const teammatesLabel = `${count} ${count === 1 ? "teammate" : "teammates"}`;
  const needYouLabel = `${group.needYou} ${group.needYou === 1 ? "needs you" : "need you"}`;
  if (!pivotGroupHasTeammates(group)) {
    // Still rendered, so the row doesn't fall back to showing the branch here.
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {group.retired ? "Retired" : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <LayoutDashboardIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger render={<span className="truncate text-muted-foreground" />}>
          {group.retired ? "Retired · " : ""}
          {count}
          <span className="sr-only"> {count === 1 ? "teammate" : "teammates"}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{teammatesLabel}</TooltipPopup>
      </Tooltip>
      {group.needYou > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<Badge size="sm" variant="warning" />}>
            {group.needYou}
            <span className="sr-only"> {group.needYou === 1 ? "needs you" : "need you"}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{needYouLabel}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** The icon a normal thread row shows for the same state; paused rests like done. */
export function teammateStatusIcon(card: TeammateCard): SidebarStatusIconKind {
  switch (card.tone) {
    case "working":
      return "working";
    case "attention":
      return card.status === "waiting" ? "approval" : card.needsYou ? "input" : "failed";
    case "failed":
      return "failed";
    case "resting":
      return "done";
  }
}
