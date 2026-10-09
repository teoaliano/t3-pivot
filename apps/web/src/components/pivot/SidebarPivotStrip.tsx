import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, LayoutDashboardIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarPivotGroup } from "../sidebar/pivotNesting.logic";
import { SidebarStatusIcon, type SidebarStatusIconKind } from "../sidebar/SidebarStatusIcon";
import { WorkingDuration } from "../sidebar/WorkingDuration";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TEAMMATE_TONE_CLASSES, type TeammateCard } from "./pivotCards.logic";

/**
 * The last line of a Pivot's sidebar row: the fold toggle, how many teammates it
 * has, and how many need the user. The row itself opens the Pivot. A Pivot with
 * nothing to fold or count leaves the line empty, apart from "Retired".
 */
export function SidebarPivotSummary(props: {
  group: SidebarPivotGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { group } = props;
  const count = group.teammates.length;
  const Chevron = props.expanded ? ChevronDownIcon : ChevronRightIcon;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  // Only the numbers show; the words stay in tooltips and for screen readers.
  const teammatesLabel = `${count} ${count === 1 ? "teammate" : "teammates"}`;
  const needYouLabel = `${group.needYou} ${group.needYou === 1 ? "needs you" : "need you"}`;
  if (count === 0 && group.needYou === 0) {
    // Still rendered, so the row doesn't fall back to showing the branch here.
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {group.retired ? "Retired" : null}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <button
        type="button"
        aria-expanded={props.expanded}
        aria-label={props.expanded ? "Hide teammates" : "Show teammates"}
        disabled={count === 0}
        // The row underneath opens the Pivot and starts drags; the toggle does neither.
        onPointerDown={stop}
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
        className="-ml-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground disabled:cursor-default disabled:opacity-0"
      >
        <Chevron className="size-3" />
      </button>
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

/**
 * A Pivot's teammates under its row: one line each, in dispatch order. Settled ones
 * are gone, as settled threads leave the inbox. Their lifecycle belongs to the Pivot,
 * so the rows carry no settle or snooze.
 */
export function SidebarTeammateList(props: {
  environmentId: EnvironmentId;
  group: SidebarPivotGroup;
  activeThreadId: ThreadId | null;
}) {
  return (
    <li role="presentation">
      <ul role="presentation" aria-label="Teammates" className="mb-1 flex flex-col gap-px">
        {props.group.teammates.map((card) => (
          <SidebarTeammateRow
            key={card.threadId}
            environmentId={props.environmentId}
            card={card}
            active={card.threadId === props.activeThreadId}
          />
        ))}
      </ul>
    </li>
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

function SidebarTeammateRow(props: {
  environmentId: EnvironmentId;
  card: TeammateCard;
  active: boolean;
}) {
  const navigate = useNavigate();
  const { card } = props;
  const tone = TEAMMATE_TONE_CLASSES[card.tone];
  return (
    <li role="presentation">
      <button
        type="button"
        aria-current={props.active ? "page" : undefined}
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(props.environmentId, card.threadId)),
          })
        }
        className={cn(
          "flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground/85 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          props.active && "bg-sidebar-row-hover text-sidebar-foreground",
        )}
      >
        {/* px-2 puts this icon's center under the Pivot row's chevron. */}
        <span className={cn("inline-flex shrink-0", tone.text)}>
          <SidebarStatusIcon kind={teammateStatusIcon(card)} />
        </span>
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {/* The status as a normal thread row shows it, with the working time. */}
        <span
          className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", tone.text)}
        >
          <span role="status">{card.label}</span>
          {card.tone === "working" ? (
            <span aria-hidden>
              <WorkingDuration startedAt={card.since} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
