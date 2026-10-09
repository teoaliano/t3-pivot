import type { ScopedThreadRef } from "@t3tools/contracts";
import { Pin, PinOff, Play, Square } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { DiscoveryListRow } from "../ui/discovery-list";

import type { ManagedPreviewRow } from "./managedPreviewLogic";
import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  row: ManagedPreviewRow<PreviewableServer>;
  onStart: () => void;
  onOpen: () => void;
  onStop: () => void;
  onSetPinned: (pinned: boolean) => void;
}

export function PreviewManagedProcessCard({
  threadRef,
  row,
  onStart,
  onOpen,
  onStop,
  onSetPinned,
}: Props) {
  const live = row.state !== "startable";
  return (
    <div className="flex w-full items-center gap-1 pr-2">
      <DiscoveryListRow
        onClick={row.state === "ready" ? onOpen : row.state === "startable" ? onStart : undefined}
        disabled={row.state === "starting"}
        icon={
          row.state === "ready" && row.server ? (
            <PreviewFaviconIcon threadRef={threadRef} url={row.server.url} />
          ) : row.state === "starting" ? (
            <Spinner size="md" tone="muted" />
          ) : (
            <Play className="size-4 shrink-0 text-muted-foreground" />
          )
        }
        title={row.scriptName}
        description={describeRow(row)}
      />
      {live || row.pinned ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={row.pinned ? `Unpin ${row.scriptName}` : `Keep ${row.scriptName} running`}
          aria-pressed={row.pinned}
          onClick={() => onSetPinned(!row.pinned)}
        >
          {row.pinned ? <PinOff /> : <Pin />}
        </Button>
      ) : null}
      {live ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Stop ${row.scriptName}`}
          onClick={onStop}
        >
          <Square />
        </Button>
      ) : null}
    </div>
  );
}

function describeRow(row: ManagedPreviewRow<PreviewableServer>): string {
  const port = row.port === null ? "" : ` on port ${row.port}`;
  const pinned = row.pinned ? " · pinned" : "";
  switch (row.state) {
    case "ready":
      return `localhost:${row.port}${pinned}`;
    case "starting":
      return `Starting${port}${pinned}`;
    case "startable":
      return row.lastError ? `${row.lastError}${pinned} · start again` : `Start${port}${pinned}`;
  }
}
