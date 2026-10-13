import type { DetectedDevScript, ManagedProcess, ProjectScript } from "@t3tools/contracts";
import { isDevProjectScript } from "@t3tools/shared/projectScripts";

/**
 * A checkout's dev server as the mobile sheet lists it. Mobile cannot preview
 * a laptop's loopback, so readiness is the server's own status rather than
 * discovery. Stopped and never-started scripts are both `startable`.
 */
export interface DevServerRow {
  readonly scriptId: string;
  readonly scriptName: string;
  readonly state: "startable" | "starting" | "running";
  readonly port: number | null;
  readonly pinned: boolean;
  readonly lastError: string | null;
}

/**
 * Every process the checkout has run, then dev actions never started. A
 * project with no dev action is offered the checkout's detected dev script.
 * Mirrors the web preview's rows.
 */
export function devServerRows(input: {
  readonly processes: ReadonlyArray<ManagedProcess>;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly detectedScript?: DetectedDevScript | null | undefined;
}): ReadonlyArray<DevServerRow> {
  const rows = input.processes.map((process): DevServerRow => ({
    scriptId: process.scriptId,
    scriptName: process.scriptName,
    state: process.status === "stopped" ? "startable" : process.status,
    port: process.port,
    pinned: process.pinned,
    lastError: process.lastError,
  }));
  const known = new Set(rows.map((row) => row.scriptId));
  const devScripts = input.scripts.filter(isDevProjectScript);
  const offered =
    devScripts.length === 0 && input.detectedScript ? [input.detectedScript] : devScripts;
  const neverStarted = offered
    .filter((script) => !known.has(script.id))
    .map((script): DevServerRow => ({
      scriptId: script.id,
      scriptName: script.name,
      state: "startable",
      port: null,
      pinned: false,
      lastError: null,
    }));
  return [...rows, ...neverStarted];
}

export function describeDevServerRow(row: DevServerRow): string {
  const pinned = row.pinned ? " · pinned" : "";
  switch (row.state) {
    case "running":
      return `Running on port ${row.port}${pinned}`;
    case "starting":
      return `Starting on port ${row.port}${pinned}`;
    case "startable":
      return `${row.lastError ?? (row.port === null ? "Not started" : "Stopped")}${pinned}`;
  }
}
