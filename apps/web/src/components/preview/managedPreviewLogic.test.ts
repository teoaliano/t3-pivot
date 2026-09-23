import type { DiscoveredLocalServer, ManagedProcess, ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  autoOpenStep,
  managedPreviewRows,
  pendingStartTarget,
  previewEmptyStateSections,
} from "./managedPreviewLogic";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

const script = (overrides: Partial<ProjectScript> & Pick<ProjectScript, "id">): ProjectScript => ({
  name: overrides.id,
  command: `pnpm ${overrides.id}`,
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

const processOf = (overrides: Partial<ManagedProcess> = {}): ManagedProcess => ({
  checkoutPath: "/work/app",
  scriptId: "dev",
  scriptName: "Dev",
  status: "starting",
  port: 11000,
  pinned: false,
  lastError: null,
  terminal: { threadId: "managed-process:abc", terminalId: "dev" },
  ...overrides,
});

const discovered = (port: number): DiscoveredLocalServer => ({
  host: "localhost",
  port,
  url: `http://localhost:${port}`,
  processName: "node",
  pid: 10,
  terminal: null,
});

const previewable = (port: number, source: PreviewableServer["source"]): PreviewableServer => ({
  ...discovered(port),
  source,
  requestedUrl: `http://localhost:${port}`,
});

const scripts = [
  script({ id: "dev", name: "Dev", previewUrl: "http://localhost:5173" }),
  script({ id: "lint", name: "Lint", icon: "lint" }),
  script({ id: "setup", name: "Setup", runOnWorktreeCreate: true }),
];

describe("managedPreviewRows", () => {
  it("offers to start a preview script that has never run", () => {
    const rows = managedPreviewRows({ processes: [], scripts, discovered: [] });

    expect(rows).toEqual([
      expect.objectContaining({ scriptId: "dev", scriptName: "Dev", state: "startable" }),
    ]);
  });

  it("offers the checkout's detected dev script when the project has no dev action", () => {
    const detectedScript = { id: "package-json:dev", name: "Dev server" };

    expect(
      managedPreviewRows({ processes: [], scripts: [], detectedScript, discovered: [] }),
    ).toEqual([
      expect.objectContaining({ scriptId: "package-json:dev", state: "startable", port: null }),
    ]);
    // A project's own dev action wins over it.
    expect(
      managedPreviewRows({ processes: [], scripts, detectedScript, discovered: [] }).map(
        (row) => row.scriptId,
      ),
    ).toEqual(["dev"]);
  });

  it("keeps a stopped process startable and shows why it stopped", () => {
    const rows = managedPreviewRows({
      processes: [processOf({ status: "stopped", lastError: "Exited with code 1" })],
      scripts,
      discovered: [],
    });

    expect(rows[0]).toMatchObject({
      state: "startable",
      port: 11000,
      lastError: "Exited with code 1",
    });
  });

  it("stays starting until the reserved port appears in discovery", () => {
    // The server already calls it running; the preview waits for its own scan.
    const running = processOf({ status: "running" });
    const before = managedPreviewRows({ processes: [running], scripts, discovered: [] });
    const after = managedPreviewRows({
      processes: [running],
      scripts,
      discovered: [discovered(11000)],
    });

    expect(before[0]?.state).toBe("starting");
    expect(after[0]).toMatchObject({ state: "ready", server: discovered(11000) });
  });
});

describe("previewEmptyStateSections", () => {
  const recents = [{ url: "http://localhost:4000" }];

  it("puts the checkout's managed process before the project file, a scan and history", () => {
    const rows = managedPreviewRows({
      processes: [processOf({ status: "running" })],
      scripts,
      discovered: [previewable(11000, "scanner")],
    });
    const sections = previewEmptyStateSections({
      rows,
      servers: [previewable(3000, "scanner"), previewable(5173, "configured")],
      recents,
    });

    expect(sections.map((section) => section.kind)).toEqual(["managed", "servers", "recents"]);
    expect(sections[1]).toMatchObject({
      servers: [
        { port: 5173, source: "configured" },
        { port: 3000, source: "scanner" },
      ],
    });
  });

  it("lists a managed process's port once, as the managed row", () => {
    const rows = managedPreviewRows({
      processes: [processOf({ status: "running" })],
      scripts,
      discovered: [previewable(11000, "scanner")],
    });
    const sections = previewEmptyStateSections({
      rows,
      servers: [previewable(11000, "scanner"), previewable(3000, "scanner")],
      recents: [],
    });

    expect(sections).toEqual([
      { kind: "managed", rows },
      { kind: "servers", servers: [previewable(3000, "scanner")] },
    ]);
  });

  it("shows nothing for a project with no preview scripts, servers or history", () => {
    expect(
      previewEmptyStateSections({
        rows: managedPreviewRows({ processes: [], scripts: [], discovered: [] }),
        servers: [],
        recents: [],
      }),
    ).toEqual([]);
  });
});

describe("pendingStartTarget", () => {
  it("does not navigate while the started process is still compiling", () => {
    const rows = managedPreviewRows({ processes: [processOf()], scripts, discovered: [] });

    expect(pendingStartTarget("dev", rows)).toBeNull();
  });

  it("navigates once the started process's port appears in discovery", () => {
    const rows = managedPreviewRows({
      processes: [processOf({ status: "running" })],
      scripts,
      discovered: [discovered(11000)],
    });

    expect(pendingStartTarget("dev", rows)).toEqual(discovered(11000));
  });
});

describe("autoOpenStep", () => {
  const autoScripts = [script({ id: "dev", autoOpenPreview: true }), script({ id: "docs" })];
  const step = (
    processes: ReadonlyArray<ManagedProcess>,
    ready: boolean,
    seenStarting: ReadonlySet<string>,
  ) =>
    autoOpenStep({
      processes,
      rows: managedPreviewRows({
        processes,
        scripts: autoScripts,
        discovered: ready ? [discovered(11000)] : [],
      }),
      scripts: autoScripts,
      seenStarting,
    });

  it("opens the preview once, after a start this client saw becomes ready", () => {
    const starting = step([processOf({ status: "starting" })], false, new Set());
    const ready = step([processOf({ status: "running" })], true, starting.seenStarting);
    const later = step([processOf({ status: "running" })], true, ready.seenStarting);

    expect(starting.open).toEqual([]);
    expect(ready.open.map((row) => row.scriptId)).toEqual(["dev"]);
    expect(later.open).toEqual([]);
  });

  it("opens nothing for a server that was already running when the client arrived", () => {
    const arrived = step([processOf({ status: "running" })], false, new Set());
    const discovered = step([processOf({ status: "running" })], true, arrived.seenStarting);

    expect(discovered.open).toEqual([]);
  });

  it("opens nothing for a script without the switch", () => {
    const docs = [processOf({ scriptId: "docs", status: "starting" })];
    const starting = step(docs, false, new Set());
    const ready = step(
      [processOf({ scriptId: "docs", status: "running" })],
      true,
      starting.seenStarting,
    );

    expect(ready.open).toEqual([]);
  });
});
