import type { DiscoveredLocalServer, ManagedProcess, ProjectScript } from "@t3tools/contracts";

import { isDevProjectScript } from "@t3tools/shared/projectScripts";

import type { PreviewableServer } from "./useDiscoveredLocalServers";

/**
 * A managed process as the preview shows it. `ready` only once the reserved
 * port appears in discovery: the scanner publishes a port after an HTTP probe
 * gets a page back, so that is the moment navigating stops risking a
 * connection error. Stopped and never-started scripts are both `startable`.
 */
export interface ManagedPreviewRow<S extends DiscoveredLocalServer = DiscoveredLocalServer> {
  readonly scriptId: string;
  readonly scriptName: string;
  readonly state: "startable" | "starting" | "ready";
  readonly port: number | null;
  readonly pinned: boolean;
  readonly lastError: string | null;
  /** The discovered server to open, once ready. */
  readonly server: S | null;
}

/**
 * Every process the checkout has run, then dev actions never started. A
 * project with no dev action is offered the checkout's detected dev script.
 */
export function managedPreviewRows<S extends DiscoveredLocalServer>(input: {
  readonly processes: ReadonlyArray<ManagedProcess>;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly detectedScript?: { readonly id: string; readonly name: string } | null | undefined;
  readonly discovered: ReadonlyArray<S>;
}): ReadonlyArray<ManagedPreviewRow<S>> {
  const rows = input.processes.map((process): ManagedPreviewRow<S> => {
    const server =
      process.status === "stopped"
        ? null
        : (input.discovered.find((candidate) => candidate.port === process.port) ?? null);
    return {
      scriptId: process.scriptId,
      scriptName: process.scriptName,
      state: process.status === "stopped" ? "startable" : server ? "ready" : "starting",
      port: process.port,
      pinned: process.pinned,
      lastError: process.lastError,
      server,
    };
  });
  const known = new Set(rows.map((row) => row.scriptId));
  const devScripts = input.scripts.filter(isDevProjectScript);
  const offered =
    devScripts.length === 0 && input.detectedScript ? [input.detectedScript] : devScripts;
  const neverStarted = offered
    .filter((script) => !known.has(script.id))
    .map((script): ManagedPreviewRow<S> => ({
      scriptId: script.id,
      scriptName: script.name,
      state: "startable",
      port: null,
      pinned: false,
      lastError: null,
      server: null,
    }));
  return [...rows, ...neverStarted];
}

/** Discovered servers other than the ones a managed row already stands for. */
function unmanagedServers(
  rows: ReadonlyArray<ManagedPreviewRow<PreviewableServer>>,
  servers: ReadonlyArray<PreviewableServer>,
): ReadonlyArray<PreviewableServer> {
  const managedPorts = new Set(rows.flatMap((row) => (row.server ? [row.server.port] : [])));
  return servers.filter((server) => !managedPorts.has(server.port));
}

export type PreviewEmptyStateSection<R> =
  | {
      readonly kind: "managed";
      readonly rows: ReadonlyArray<ManagedPreviewRow<PreviewableServer>>;
    }
  | { readonly kind: "servers"; readonly servers: ReadonlyArray<PreviewableServer> }
  | { readonly kind: "recents"; readonly entries: ReadonlyArray<R> };

/**
 * The checkout's own managed processes come first, since each is this
 * checkout's server by construction. Everything after is inference: URLs from
 * the project file and scanned servers (configured first), then history.
 * Empty sections are dropped.
 */
export function previewEmptyStateSections<R>(input: {
  readonly rows: ReadonlyArray<ManagedPreviewRow<PreviewableServer>>;
  readonly servers: ReadonlyArray<PreviewableServer>;
  readonly recents: ReadonlyArray<R>;
}): ReadonlyArray<PreviewEmptyStateSection<R>> {
  const servers = unmanagedServers(input.rows, input.servers).toSorted(
    (left, right) => Number(left.source !== "configured") - Number(right.source !== "configured"),
  );
  const sections: Array<PreviewEmptyStateSection<R>> = [
    { kind: "managed", rows: input.rows },
    { kind: "servers", servers },
    { kind: "recents", entries: input.recents },
  ];
  return sections.filter((section) =>
    section.kind === "managed"
      ? section.rows.length > 0
      : section.kind === "servers"
        ? section.servers.length > 0
        : section.entries.length > 0,
  );
}

/** The server a tab that pressed Start should navigate to, or null while it still compiles. */
export function pendingStartTarget<S extends DiscoveredLocalServer>(
  scriptId: string,
  rows: ReadonlyArray<ManagedPreviewRow<S>>,
): S | null {
  const row = rows.find((candidate) => candidate.scriptId === scriptId);
  return row?.state === "ready" ? row.server : null;
}

/**
 * One step of the automatic preview for scripts that declare `autoOpenPreview`.
 * A process counts only once this client has seen it starting, so switching
 * to a checkout whose server is already up opens nothing. Each start opens
 * once: an opened or stopped process leaves the set.
 */
export function autoOpenStep<S extends DiscoveredLocalServer>(input: {
  readonly processes: ReadonlyArray<ManagedProcess>;
  readonly rows: ReadonlyArray<ManagedPreviewRow<S>>;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly seenStarting: ReadonlySet<string>;
}): {
  readonly open: ReadonlyArray<ManagedPreviewRow<S>>;
  readonly seenStarting: ReadonlySet<string>;
} {
  const autoOpen = new Set(
    input.scripts.filter((script) => script.autoOpenPreview === true).map((script) => script.id),
  );
  const seen = new Set(input.seenStarting);
  for (const process of input.processes) {
    if (process.status === "stopped") seen.delete(process.scriptId);
    else if (process.status === "starting" && autoOpen.has(process.scriptId)) {
      seen.add(process.scriptId);
    }
  }
  const open = input.rows.filter((row) => row.state === "ready" && seen.has(row.scriptId));
  for (const row of open) seen.delete(row.scriptId);
  return { open, seenStarting: seen };
}
