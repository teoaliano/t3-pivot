import type {
  EnvironmentId,
  OrchestrationV2TurnItem,
  TeammateRecord,
  TeammateStatus,
  ThreadId,
} from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useThreadShells } from "../../state/entities";
import {
  SUBAGENT_ROW_CLASS,
  SUBAGENT_ROW_INTERACTIVE_CLASS,
  SubagentAvatar,
  SubagentRowContent,
} from "../chat/V2LifecycleRow";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import {
  elapsedLabel,
  setupProgressLine,
  type TeammateCard,
  teammateCardShellOf,
  teammateCards,
} from "./pivotCards.logic";
import type { TeammatePaneKind } from "./pivotLayout.logic";

/** Where each card menu entry opens the teammate. Clicking the card is View chat. */
const OPEN_ACTIONS: ReadonlyArray<{ readonly kind: TeammatePaneKind; readonly label: string }> = [
  { kind: "teammate", label: "View chat" },
  { kind: "diff", label: "View diff" },
  { kind: "files", label: "View files" },
  { kind: "preview", label: "View preview" },
];

/**
 * One subagent-style row per teammate in dispatch order, finished ones folded into
 * a section at the end. Nothing here animates; elapsed times move once a minute.
 */
export function PivotTeammatesPane(props: {
  environmentId: EnvironmentId;
  teammates: ReadonlyArray<TeammateRecord>;
  providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  onOpen: (kind: TeammatePaneKind, teammate: ThreadId) => void;
}) {
  const [showFinished, setShowFinished] = useState(false);
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
      <p className="p-4 text-sm text-muted-foreground">
        No teammates yet. Tell the Pivot what you want done and it dispatches them.
      </p>
    );
  }
  const render = (card: TeammateCard) => (
    <PivotTeammateCard
      key={card.threadId}
      environmentId={props.environmentId}
      card={card}
      nowMs={nowMs}
      providerEntries={props.providerEntries}
      onOpen={props.onOpen}
    />
  );
  return (
    <div className="h-full overflow-y-auto p-2">
      {cards.live.map(render)}
      {cards.finished.length > 0 ? (
        <>
          <CollapsibleSectionHeader
            expanded={showFinished}
            onClick={() => setShowFinished((value) => !value)}
          >
            Finished
            {!showFinished && ` (${cards.finished.length})`}
          </CollapsibleSectionHeader>
          {showFinished ? cards.finished.map(render) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Teammate states drawn with the subagent dot colors. A state that asks someone to act
 * has no subagent equivalent, so it gets the warning dot instead.
 */
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

/**
 * The worktree setup in progress, or how it went wrong, as the row's detail line.
 * Subscribes only while the card follows setup, so a settled team holds no setup streams.
 */
function TeammateSetupRow(props: Parameters<typeof PivotTeammateRow>[0]) {
  const setup = useEnvironmentQuery(
    vcsEnvironment.worktreeSetup({
      environmentId: props.environmentId,
      input: { threadId: props.card.threadId },
    }),
  );
  const line = setupProgressLine(setup.data ?? null);
  return <PivotTeammateRow {...props} detail={line ?? props.detail} />;
}

const PivotTeammateCard = memo(function PivotTeammateCard(
  props: Omit<Parameters<typeof PivotTeammateRow>[0], "detail">,
) {
  return props.card.followsSetup ? (
    <TeammateSetupRow {...props} detail={props.card.detail} />
  ) : (
    <PivotTeammateRow {...props} detail={props.card.detail} />
  );
});

/** A teammate drawn as a subagent row, with the PR number by its elapsed time. */
function PivotTeammateRow(props: {
  environmentId: EnvironmentId;
  card: TeammateCard;
  detail: string | null;
  nowMs: number;
  providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  onOpen: (kind: TeammatePaneKind, teammate: ThreadId) => void;
}) {
  const { card } = props;
  const elapsed = elapsedLabel(card.since, props.nowMs);
  const provider =
    card.providerInstanceId === null
      ? null
      : (props.providerEntries.get(card.providerInstanceId) ?? null);
  const failed = card.status === "failed";
  const tag =
    card.footer?.kind === "pull-request"
      ? `#${card.footer.number}`
      : card.footer?.kind === "scout"
        ? "Scout"
        : null;
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
      className={cn(SUBAGENT_ROW_CLASS, SUBAGENT_ROW_INTERACTIVE_CLASS)}
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
            dotClassName={card.attention && !failed ? "bg-warning" : undefined}
          />
        }
        title={card.title}
        statusLabel={card.label}
        showStatus
        detail={props.detail}
        failed={failed}
        trailing={[tag, elapsed].filter((part) => part !== null).join(" · ")}
        actions={
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
        }
        chevron
      />
    </div>
  );
  // The full report or error, which one truncated line can cut short.
  return props.detail === null ? (
    element
  ) : (
    <Tooltip>
      <TooltipTrigger delay={200} render={element} />
      <TooltipPopup side="bottom">{props.detail}</TooltipPopup>
    </Tooltip>
  );
}
