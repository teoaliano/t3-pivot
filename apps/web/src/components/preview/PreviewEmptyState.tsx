import {
  ManagedProcessPortOccupiedError,
  type EnvironmentId,
  type ProjectScript,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { Globe, History, RadioTower, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { managedProcessEnvironment } from "~/state/managedProcesses";
import { useAtomCommand } from "~/state/use-atom-command";
import { DiscoveryList } from "../ui/discovery-list";

import {
  managedPreviewRows,
  pendingStartTarget,
  previewEmptyStateSections,
} from "./managedPreviewLogic";
import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { PreviewManagedProcessCard } from "./PreviewManagedProcessCard";
import { PreviewRecentUrlCard } from "./PreviewRecentUrlCard";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";
import { useManagedProcesses } from "./useManagedProcesses";

interface Props {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  /** The thread's checkout: its worktree, or the project root. Null without a project. */
  checkoutPath?: string | null | undefined;
  scripts?: ReadonlyArray<ProjectScript> | undefined;
  recentEntries: ReadonlyArray<BrowserHistoryEntry>;
  onRemoveRecent: (url: string) => void;
  onOpenUrl: (url: string) => void;
}

const NO_SCRIPTS: ReadonlyArray<ProjectScript> = [];
const isPortOccupied = Schema.is(ManagedProcessPortOccupiedError);

export function PreviewEmptyState({
  threadRef,
  environmentId,
  configuredUrls,
  checkoutPath = null,
  scripts = NO_SCRIPTS,
  recentEntries,
  onRemoveRecent,
  onOpenUrl,
}: Props) {
  const servers = useDiscoveredLocalServers({
    environmentId,
    configuredUrls,
  });
  const { processes, detectedScript } = useManagedProcesses(environmentId, checkoutPath);
  const rows = useMemo(
    () => managedPreviewRows({ processes, scripts, detectedScript, discovered: servers }),
    [detectedScript, processes, scripts, servers],
  );
  const recents = recentEntries.filter((entry) => URL.canParse(entry.url)).slice(0, 8);
  const sections = previewEmptyStateSections({ rows, servers, recents });

  const start = useAtomCommand(managedProcessEnvironment.start, { reportFailure: false });
  const stop = useAtomCommand(managedProcessEnvironment.stop);
  const setPinned = useAtomCommand(managedProcessEnvironment.setPinned);
  // The script this tab started. The tab navigates to it once its port shows
  // up in discovery, which is when it serves a page.
  const pendingScriptId = useRef<string | null>(null);
  useEffect(() => {
    if (pendingScriptId.current === null) return;
    const target = pendingStartTarget(pendingScriptId.current, rows);
    if (!target) return;
    pendingScriptId.current = null;
    onOpenUrl(target.requestedUrl);
  }, [onOpenUrl, rows]);

  const handleStart = useCallback(
    async function startScript(scriptId: string, reallocate = false): Promise<void> {
      pendingScriptId.current = scriptId;
      const result = await start({
        environmentId,
        input: { threadId: threadRef.threadId, scriptId, ...(reallocate ? { reallocate } : {}) },
      });
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      pendingScriptId.current = null;
      const error = squashAtomCommandFailure(result);
      if (isPortOccupied(error)) {
        const occupied = error;
        const toastId = toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: `Port ${occupied.port} is taken`,
            description: `${describeOccupant(occupied)} holds this checkout's port. It was left running.`,
            actionProps: {
              children: "Use a new port",
              onClick: () => {
                toastManager.close(toastId);
                void startScript(scriptId, true);
              },
            },
          }),
        );
        return;
      }
      toastManager.add({
        type: "error",
        title: "Could not start the dev server",
        description: error instanceof Error ? error.message : String(error),
      });
    },
    [environmentId, start, threadRef.threadId],
  );

  if (sections.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Globe className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No preview yet</EmptyTitle>
        <EmptyDescription>
          Type a URL above, or run a dev script. Browser-ready localhost servers will show up here
          automatically.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-5 py-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {sections.map((section) =>
          section.kind === "managed" ? (
            <div key="managed" className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SquareTerminal className="size-4 shrink-0" />
                <h2 className="font-medium">Dev servers</h2>
              </div>
              <DiscoveryList>
                {section.rows.map((row) => (
                  <PreviewManagedProcessCard
                    key={row.scriptId}
                    threadRef={threadRef}
                    row={row}
                    onStart={() => void handleStart(row.scriptId)}
                    onOpen={() => {
                      if (row.server) onOpenUrl(row.server.requestedUrl);
                    }}
                    onStop={() => {
                      if (checkoutPath === null) return;
                      void stop({ environmentId, input: { checkoutPath, scriptId: row.scriptId } });
                    }}
                    onSetPinned={(pinned) => {
                      if (checkoutPath === null) return;
                      void setPinned({
                        environmentId,
                        input: { checkoutPath, scriptId: row.scriptId, pinned },
                      });
                    }}
                  />
                ))}
              </DiscoveryList>
              <p className="px-1 text-xs text-muted-foreground">
                Servers nobody has used for 30 minutes stop on their own. Pin one to keep it
                running.
              </p>
            </div>
          ) : section.kind === "servers" ? (
            <div key="servers" className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RadioTower className="size-4 shrink-0" />
                <h2 className="font-medium">Local servers</h2>
              </div>
              <DiscoveryList>
                {section.servers.map((server) => (
                  <PreviewLocalServerCard
                    key={`${server.host}:${server.port}`}
                    threadRef={threadRef}
                    server={server}
                    onOpen={() => onOpenUrl(server.requestedUrl)}
                  />
                ))}
              </DiscoveryList>
              <p className="px-1 text-xs text-muted-foreground">
                Select a live local server to open it in this browser tab.
              </p>
            </div>
          ) : (
            <div key="recents" className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <History className="size-4 shrink-0" />
                <h2 className="font-medium">Recently used</h2>
              </div>
              <DiscoveryList>
                {section.entries.map((entry) => (
                  <PreviewRecentUrlCard
                    key={entry.url}
                    threadRef={threadRef}
                    entry={entry}
                    onOpen={() => onOpenUrl(entry.url)}
                    onRemove={() => onRemoveRecent(entry.url)}
                  />
                ))}
              </DiscoveryList>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function describeOccupant(error: ManagedProcessPortOccupiedError): string {
  const name = error.occupantProcessName ?? "Another process";
  const pid = error.occupantPid === null ? "" : ` (pid ${error.occupantPid})`;
  return error.occupantCommand
    ? `${name}${pid}, running "${error.occupantCommand}",`
    : `${name}${pid}`;
}
