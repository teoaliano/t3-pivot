import type { ManagedProcess, ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { devServerRows } from "./dev-servers";

const script = (id: string, overrides: Partial<ProjectScript> = {}): ProjectScript => ({
  id,
  name: id,
  command: `pnpm ${id}`,
  icon: "play",
  runOnWorktreeCreate: false,
  ...overrides,
});

const process = (scriptId: string, overrides: Partial<ManagedProcess> = {}): ManagedProcess => ({
  checkoutPath: "/work/app",
  scriptId,
  scriptName: scriptId,
  status: "running",
  port: 11000,
  pinned: false,
  lastError: null,
  terminal: { threadId: "managed-process:1", terminalId: scriptId },
  ...overrides,
});

const detectedScript = { id: "package-json:dev", name: "Dev server", command: "pnpm run dev" };

describe("devServerRows", () => {
  it("lists running processes first, then dev actions that were never started", () => {
    const rows = devServerRows({
      processes: [process("dev")],
      scripts: [script("dev"), script("storybook"), script("lint", { icon: "lint" })],
    });

    expect(rows.map((row) => [row.scriptId, row.state])).toEqual([
      ["dev", "running"],
      ["storybook", "startable"],
    ]);
  });

  it("offers a stopped process again, keeping its pin and the reason it stopped", () => {
    const [row] = devServerRows({
      processes: [
        process("dev", { status: "stopped", pinned: true, lastError: "Exited with code 1" }),
      ],
      scripts: [script("dev")],
    });

    expect(row).toMatchObject({
      state: "startable",
      pinned: true,
      lastError: "Exited with code 1",
    });
  });

  it("reports a process still compiling as starting", () => {
    const [row] = devServerRows({
      processes: [process("dev", { status: "starting" })],
      scripts: [],
    });

    expect(row?.state).toBe("starting");
  });

  it("offers the package.json dev script only when the project declares no dev action", () => {
    const withoutAction = devServerRows({ processes: [], scripts: [], detectedScript });
    const withAction = devServerRows({ processes: [], scripts: [script("dev")], detectedScript });

    expect(withoutAction.map((row) => row.scriptId)).toEqual(["package-json:dev"]);
    expect(withAction.map((row) => row.scriptId)).toEqual(["dev"]);
  });
});
