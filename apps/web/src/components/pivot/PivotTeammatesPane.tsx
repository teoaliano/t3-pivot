import type {
  EnvironmentId,
  OrchestrationV2TurnItem,
  TeammateRecord,
  TeammateStatus,
  ThreadId,
} from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useThreadShells } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import {
  SUBAGENT_ROW_CLASS,
  SUBAGENT_ROW_INTERACTIVE_CLASS,
  SubagentAvatar,
  SubagentRowContent,
} from "../chat/V2LifecycleRow";
import { SidebarStatusIcon } from "../sidebar/SidebarStatusIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  elapsedLabel,
  setupProgressLine,
  TEAMMATE_TONE_CLASSES,
  type TeammateCard,
  teammateCardShellOf,
  teammateCards,
} from "./pivotCards.logic";
import type { TeammatePaneKind } from "./pivotLayout.logic";
import { teammateStatusIcon } from "./SidebarPivotStrip";

/** Where each card menu entry opens the teammate. Clicking the card is View chat. */
const OPEN_ACTIONS: ReadonlyArray<{ readonly kind: TeammatePaneKind; readonly label: string }> = [
  { kind: "teammate", label: "View chat" },
  { kind: "diff", label: "View diff" },
  { kind: "files", label: "View files" },
  { kind: "preview", label: "View preview" },
];

/**
 * The Pivot's teammates as a strip of cards in dispatch order, wrapping onto
 * centered rows, with finished ones folded into one chip at the end. Nothing here
 * animates; elapsed times move once a minute.
 */
export function PivotTeammatesPane(props: {
  environmentId: EnvironmentId;
  teammates: ReadonlyArray<TeammateRecord>;
  providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  onOpen: (kind: TeammatePaneKind, teammate: ThreadId) => void;
}) {
  const nowMinute = useNowMinute();
  const nowMs = useMemo(() => Date.parse(`${nowMinute}:00.000Z`), [nowMinute]);
  const shells = useThreadShells();
  const cards = useMemo(() => {
    const byId = new Map(
      shells
        .filter((shell) => shell.environmentId === props.environmentId)
        .map((shell) => [shell.id as string, shell] as const),
    );
    return teammateCards(props.teammates, (threadId) => {
      const shell = byId.get(threadId);
      return shell === undefined ? null : teammateCardShellOf(shell.source, shell.pullRequests);
    });
  }, [props.environmentId, props.teammates, shells]);

  if (props.teammates.length === 0) {
    return (
      <p className="flex min-h-0 flex-auto items-center justify-center p-4 text-center text-sm text-muted-foreground">
        No teammates yet. Tell the Pivot what you want done and it dispatches them.
      </p>
    );
  }
  return (
    // Centered in the strip; m-auto rather than centering keeps an overflowing top reachable.
    <div className="flex min-h-0 flex-auto overflow-y-auto p-1 scrollbar-gutter-both">
      <div className="m-auto flex flex-wrap items-stretch justify-center gap-2">
        {cards.live.map((card) => (
          <PivotTeammateCard
            key={card.threadId}
            environmentId={props.environmentId}
            card={card}
            nowMs={nowMs}
            providerEntries={props.providerEntries}
            onOpen={props.onOpen}
          />
        ))}
        {cards.finished.length > 0 ? (
          <FinishedChip
            cards={cards.finished}
            onOpen={(threadId) => props.onOpen("teammate", threadId)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The finished teammates behind one chip; each opens like a card. */
function FinishedChip(props: {
  cards: ReadonlyArray<TeammateCard>;
  onOpen: (threadId: ThreadId) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="h-9 cursor-pointer self-center rounded-lg border border-border bg-background/90 px-3 text-sm font-medium transition-colors hover:bg-accent"
          />
        }
      >
        {props.cards.length} finished
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="center">
        <ul aria-label="Finished teammates" className="flex max-h-80 w-72 flex-col overflow-y-auto">
          {props.cards.map((card) => {
            const tone = TEAMMATE_TONE_CLASSES[card.tone];
            return (
              <li key={card.threadId}>
                <button
                  type="button"
                  onClick={() => props.onOpen(card.threadId)}
                  className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
                >
                  <span className={cn("inline-flex shrink-0", tone.text)}>
                    <SidebarStatusIcon kind={teammateStatusIcon(card)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  {card.footer?.kind === "pull-request" ? (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      PR#{card.footer.number}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}

type TeammateCardProps = {
  environmentId: EnvironmentId;
  card: TeammateCard;
  detail: string | null;
  nowMs: number;
  providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  onOpen: (kind: TeammatePaneKind, teammate: ThreadId) => void;
};

/**
 * The worktree setup in progress, or how it went wrong, as the card's detail.
 * Subscribes only while the card follows setup, so a settled team holds no setup streams.
 */
function TeammateSetupCard(props: TeammateCardProps) {
  const setup = useEnvironmentQuery(
    vcsEnvironment.worktreeSetup({
      environmentId: props.environmentId,
      input: { threadId: props.card.threadId },
    }),
  );
  const line = setupProgressLine(setup.data ?? null);
  return <TeammateCardBody {...props} detail={line ?? props.detail} />;
}

const PivotTeammateCard = memo(function PivotTeammateCard(
  props: Omit<TeammateCardProps, "detail">,
) {
  return props.card.followsSetup ? (
    <TeammateSetupCard {...props} detail={props.card.detail} />
  ) : (
    <TeammateCardBody {...props} detail={props.card.detail} />
  );
});

/** Teammate states as subagent states; the dot takes the teammate's thread status color. */
const SUBAGENT_STATUS: Record<TeammateStatus, OrchestrationV2TurnItem["status"]> = {
  working: "running",
  waiting: "waiting",
  "needs-decision": "waiting",
  blocked: "waiting",
  paused: "idle",
  done: "completed",
  failed: "failed",
  unreported: "cancelled",
};

/** One teammate as a card holding the subagent row a normal thread shows, title wrapping. */
function TeammateCardBody(props: TeammateCardProps) {
  const { card } = props;
  const provider =
    card.providerInstanceId === null
      ? null
      : (props.providerEntries.get(card.providerInstanceId) ?? null);
  const element = (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${card.title}`}
      aria-description={card.label}
      data-pivot-teammate-card="true"
      data-attention={card.attention ? "true" : undefined}
      onClick={() => props.onOpen("teammate", card.threadId)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen("teammate", card.threadId);
        }
      }}
      className={cn(
        SUBAGENT_ROW_CLASS,
        SUBAGENT_ROW_INTERACTIVE_CLASS,
        "relative w-72 rounded-lg border bg-background/90",
        card.attention ? "border-warning/60" : "border-border",
      )}
    >
      <SubagentRowContent
        avatar={
          <SubagentAvatar
            driver={provider?.driverKind}
            provider={
              provider === null
                ? undefined
                : { displayName: provider.displayName, iconUrl: provider.acpRegistryIconUrl }
            }
            status={SUBAGENT_STATUS[card.status]}
            dotClassName={TEAMMATE_TONE_CLASSES[card.tone].dot}
          />
        }
        title={card.title}
        statusLabel={card.label}
        // The title gets the card's width: status and time share the second line, and the
        // report, setup progress or error stays in the tooltip.
        showStatus
        detail={null}
        failed={card.status === "failed"}
        trailing={null}
        statusSuffix={elapsedLabel(card.since, props.nowMs)}
        wrapTitle
        chevron={false}
      />
      {/* Over the card's corner, beside the short status line, shown on hover or focus. */}
      <span className="absolute right-1.5 bottom-1.5 inline-flex opacity-0 group-hover/subagent:opacity-100 focus-within:opacity-100 has-data-[popup-open]:opacity-100">
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Teammate actions"
                onClick={(event) => event.stopPropagation()}
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end">
            {OPEN_ACTIONS.map((action) => (
              <MenuItem
                key={action.kind}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpen(action.kind, card.threadId);
                }}
              >
                {action.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </span>
    </div>
  );
  // The full title, which two lines can cut short, then the report, setup progress or error.
  return (
    <Tooltip>
      <TooltipTrigger delay={200} render={element} />
      <TooltipPopup side="bottom">
        <span className="block font-medium">{card.title}</span>
        {props.detail !== null ? (
          <span className="mt-1 block text-muted-foreground">{props.detail}</span>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}
