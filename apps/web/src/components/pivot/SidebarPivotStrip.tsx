import type { SidebarPivotGroup } from "../sidebar/pivotNesting.logic";
import { pivotGroupHasTeammates } from "../sidebar/pivotNesting.logic";
import { SidebarStatusIcon, type SidebarStatusIconKind } from "../sidebar/SidebarStatusIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TEAMMATE_TONE_CLASSES, type TeammateCard } from "./pivotCards.logic";

/**
 * The last line of a Pivot's sidebar row: one group per state its teammates are in,
 * each with the icon that state shows on a thread row and how many teammates are in it.
 * Only states with teammates show. The teammates themselves live in the Pivot's right
 * panel. A Pivot with nothing to count says "No teammates", or "Retired" once retired.
 */
export function SidebarPivotSummary(props: { group: SidebarPivotGroup }) {
  const { group } = props;
  if (!pivotGroupHasTeammates(group)) {
    // Still rendered, so the row doesn't fall back to showing the branch here.
    return (
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {group.retired ? "Retired" : "No teammates"}
      </span>
    );
  }
  // Needs-you teammates show the icon of the first one; the Pivot's own decisions ask a question.
  const needYouCard =
    group.teammates.find((card) => card.needsYou) ??
    group.teammates.find((card) => card.tone === "attention" || card.tone === "failed");
  const states: ReadonlyArray<{
    readonly key: string;
    readonly count: number;
    readonly icon: SidebarStatusIconKind;
    readonly textClass: string;
    readonly label: string;
  }> = [
    {
      key: "needs-you",
      count: group.needYou,
      icon: needYouCard ? teammateStatusIcon(needYouCard) : "input",
      textClass: TEAMMATE_TONE_CLASSES.attention.text,
      label: `${group.needYou} ${group.needYou === 1 ? "needs you" : "need you"}`,
    },
    {
      key: "working",
      count: group.working,
      icon: "working",
      textClass: TEAMMATE_TONE_CLASSES.working.text,
      label: `${group.working} working`,
    },
    {
      key: "done",
      count: group.done,
      icon: "done",
      textClass: TEAMMATE_TONE_CLASSES.resting.text,
      label: `${group.done} done`,
    },
  ];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {group.retired ? <span className="truncate text-muted-foreground">Retired</span> : null}
      {states
        .filter((state) => state.count > 0)
        .map((state) => (
          <Tooltip key={state.key}>
            <TooltipTrigger
              render={<span className={`flex shrink-0 items-center gap-1 ${state.textClass}`} />}
            >
              <SidebarStatusIcon kind={state.icon} />
              {/* Only the numbers show; the words stay in tooltips and for screen readers. */}
              <span className="tabular-nums">{state.count}</span>
              <span className="sr-only"> {state.label}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">{state.label}</TooltipPopup>
          </Tooltip>
        ))}
    </span>
  );
}

/** The icon a normal thread row shows for the same state; paused rests like done. */
function teammateStatusIcon(card: TeammateCard): SidebarStatusIconKind {
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
