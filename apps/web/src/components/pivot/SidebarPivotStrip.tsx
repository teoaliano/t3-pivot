import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon, LayoutDashboardIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarPivotGroup } from "../sidebar/pivotNesting.logic";
import { Badge } from "../ui/badge";
import type { TeammateCard } from "./pivotCards.logic";

/**
 * The last line of a Pivot's sidebar row: the fold toggle, how many teammates it
 * has, and how many need the user. The row itself opens the Pivot.
 */
export function SidebarPivotSummary(props: {
  group: SidebarPivotGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { group } = props;
  const count = group.live.length + group.finished.length;
  const Chevron = props.expanded ? ChevronDownIcon : ChevronRightIcon;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  // Only the numbers show; the words stay in the tooltip and for screen readers.
  const teammatesLabel = `${count} ${count === 1 ? "teammate" : "teammates"}`;
  const needYouLabel = `${group.needYou} ${group.needYou === 1 ? "needs you" : "need you"}`;
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
      <span className="truncate text-muted-foreground" title={teammatesLabel}>
        {group.retired ? "Retired · " : ""}
        {count}
        <span className="sr-only"> {count === 1 ? "teammate" : "teammates"}</span>
      </span>
      {group.needYou > 0 ? (
        <Badge size="sm" variant="warning" title={needYouLabel}>
          {group.needYou}
          <span className="sr-only"> {group.needYou === 1 ? "needs you" : "need you"}</span>
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * A Pivot's teammates under its row: one line each, in dispatch order, finished ones
 * folded. Their lifecycle belongs to the Pivot, so the rows carry no settle or snooze.
 */
export function SidebarTeammateList(props: {
  environmentId: EnvironmentId;
  group: SidebarPivotGroup;
  activeThreadId: ThreadId | null;
}) {
  const [showFinished, setShowFinished] = useState(false);
  const { group } = props;
  const finishedShown = showFinished || group.live.length === 0;
  const row = (card: TeammateCard) => (
    <SidebarTeammateRow
      key={card.threadId}
      environmentId={props.environmentId}
      card={card}
      active={card.threadId === props.activeThreadId}
    />
  );
  return (
    <li role="presentation">
      <ul
        role="presentation"
        aria-label="Teammates"
        className="mb-1 ml-4 flex flex-col gap-px border-l border-sidebar-border pl-1"
      >
        {group.live.map(row)}
        {group.finished.length > 0 && group.live.length > 0 ? (
          <li role="presentation">
            <button
              type="button"
              aria-expanded={finishedShown}
              onClick={() => setShowFinished((shown) => !shown)}
              className="cursor-pointer rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            >
              {finishedShown ? "Hide finished" : `${group.finished.length} finished`}
            </button>
          </li>
        ) : null}
        {finishedShown ? group.finished.map(row) : null}
      </ul>
    </li>
  );
}

function SidebarTeammateRow(props: {
  environmentId: EnvironmentId;
  card: TeammateCard;
  active: boolean;
}) {
  const navigate = useNavigate();
  const { card } = props;
  const tag = card.needsYou
    ? "Needs you"
    : card.attention || card.status === "paused"
      ? card.label
      : card.footer?.kind === "pull-request"
        ? `#${card.footer.number}`
        : card.footer?.kind === "scout"
          ? "Scout"
          : null;
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
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            card.attention
              ? "bg-warning"
              : card.status === "working"
                ? "bg-success"
                : "bg-muted-foreground/50",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{card.title}</span>
        {tag !== null ? (
          <span
            className={cn(
              "shrink-0 text-xs",
              card.needsYou ? "text-warning-foreground" : "text-muted-foreground",
            )}
          >
            {tag}
          </span>
        ) : null}
      </button>
    </li>
  );
}
