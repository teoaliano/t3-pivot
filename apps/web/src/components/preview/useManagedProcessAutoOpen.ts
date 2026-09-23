import type { ProjectScript, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { useDiscoveredPortsState } from "~/portDiscoveryState";
import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import { autoOpenStep, managedPreviewRows } from "./managedPreviewLogic";
import { openDiscoveredPort } from "./openDiscoveredPort";
import { useManagedProcesses } from "./useManagedProcesses";

const NO_SEEN: ReadonlySet<string> = new Set();

/**
 * Honours `autoOpenPreview`: once a started script's port serves a page, the
 * preview opens on it. Discovery is only watched while such a script is
 * running, so an idle thread costs no port scans. A preview already showing
 * for this thread is left alone, since the tab that pressed Start navigates
 * itself.
 */
export function useManagedProcessAutoOpen(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly checkoutPath: string | null;
  readonly scripts: ReadonlyArray<ProjectScript>;
}) {
  const environmentId = input.threadRef?.environmentId ?? null;
  const processes = useManagedProcesses(environmentId, input.checkoutPath);
  const watching = processes.some(
    (process) =>
      process.status !== "stopped" &&
      input.scripts.some((script) => script.id === process.scriptId && script.autoOpenPreview),
  );
  const { servers } = useDiscoveredPortsState(watching ? environmentId : null);
  const rows = useMemo(
    () => managedPreviewRows({ processes, scripts: input.scripts, discovered: servers }),
    [input.scripts, processes, servers],
  );
  const previewShowing = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, input.threadRef) === "preview",
  );
  const openPreview = useAtomCommand(previewEnvironment.open);
  // Keyed on the checkout, so switching threads never carries a start across.
  const seenStarting = useRef({ checkoutPath: input.checkoutPath, scripts: NO_SEEN });
  const { checkoutPath, scripts, threadRef } = input;

  useEffect(() => {
    const seen = seenStarting.current;
    const step = autoOpenStep({
      processes,
      rows,
      scripts,
      seenStarting: seen.checkoutPath === checkoutPath ? seen.scripts : NO_SEEN,
    });
    seenStarting.current = { checkoutPath, scripts: step.seenStarting };
    if (!threadRef || previewShowing) return;
    const [row] = step.open;
    if (row?.server) void openDiscoveredPort({ threadRef, port: row.server, openPreview });
  }, [checkoutPath, openPreview, previewShowing, processes, rows, scripts, threadRef]);
}
