import type { ManagedProcess } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { managedProcessOverviewRows } from "./managedProcessOverview.logic";

const process = (checkoutPath: string, scriptId = "dev"): ManagedProcess => ({
  checkoutPath,
  scriptId,
  scriptName: scriptId,
  status: "running",
  port: 11000,
  pinned: false,
  lastError: null,
  terminal: { threadId: "managed-process:1", terminalId: scriptId },
});

const names = {
  projects: [{ id: "project-1", title: "Web app", workspaceRoot: "/work/app" }],
  threads: [
    { projectId: "project-1", worktreePath: null, branch: "main" },
    { projectId: "project-1", worktreePath: "/wt/app/feature-login", branch: "feature/login" },
  ],
};

describe("managedProcessOverviewRows", () => {
  it("groups a checkout's processes under one row", () => {
    const rows = managedProcessOverviewRows(
      [process("/work/app"), process("/work/app", "storybook"), process("/wt/app/feature-login")],
      names,
    );

    expect(rows.map((row) => [row.checkoutPath, row.processes.map((p) => p.scriptId)])).toEqual([
      ["/work/app", ["dev", "storybook"]],
      ["/wt/app/feature-login", ["dev"]],
    ]);
  });

  it("names a main folder by its project and a worktree by its project and branch", () => {
    const rows = managedProcessOverviewRows(
      [process("/work/app"), process("/wt/app/feature-login")],
      names,
    );

    expect(rows.map((row) => row.checkoutLabel)).toEqual(["Web app", "Web app · feature/login"]);
  });

  it("falls back to the folder name for a checkout no thread knows", () => {
    const rows = managedProcessOverviewRows([process("/wt/app/orphaned/")], names);

    expect(rows[0]?.checkoutLabel).toBe("orphaned");
  });
});
