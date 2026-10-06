import type { EnvironmentId, TeammateRecord, ThreadId } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useThreadShells } from "../../state/entities";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  elapsedLabel,
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
 * One card per teammate in dispatch order, finished ones folded into a chip at
 * the end. Nothing here animates; elapsed times move once a minute.
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
      card={card}
      nowMs={nowMs}
      providerEntries={props.providerEntries}
      onOpen={props.onOpen}
    />
  );
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex flex-wrap content-start gap-2">
        {cards.live.map(render)}
        {cards.finished.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((value) => !value)}
          >
            {cards.finished.length} finished
          </Button>
        ) : null}
        {showFinished ? cards.finished.map(render) : null}
      </div>
    </div>
  );
}

const PivotTeammateCard = memo(function PivotTeammateCard(props: {
  card: TeammateCard;
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
  return (
    <div
      role="button"
      tabIndex={0}
      data-pivot-teammate-card="true"
      data-attention={card.attention ? "true" : undefined}
      onClick={() => props.onOpen("teammate", card.threadId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen("teammate", card.threadId);
        }
      }}
      className={cn(
        "flex w-60 cursor-pointer flex-col gap-2 rounded-xl border bg-background p-3 text-left",
        card.attention ? "border-warning" : "border-border",
      )}
      title={card.detail ?? undefined}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
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
          <span className="truncate font-medium">{card.label}</span>
          {elapsed !== null ? <span className="text-muted-foreground">{elapsed}</span> : null}
        </span>
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
      </div>
      <div className="line-clamp-2 text-sm">{card.title}</div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {card.footer?.kind === "pull-request"
            ? `#${card.footer.number}`
            : card.footer?.kind === "scout"
              ? "Scout"
              : null}
        </span>
        {provider !== null ? (
          <ProviderInstanceIcon
            driverKind={provider.driverKind}
            displayName={provider.displayName}
            accentColor={provider.accentColor}
            acpRegistryAgentId={provider.acpRegistryAgentId}
            acpRegistryIconUrl={provider.acpRegistryIconUrl}
            iconClassName="size-3.5"
          />
        ) : null}
      </div>
    </div>
  );
});
