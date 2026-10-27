import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PivotRecord,
  type TeammateRecord,
} from "@t3tools/contracts";
import type { PivotState } from "@t3tools/client-runtime/pivot-state";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";

const mocks = vi.hoisted(() => ({
  projection: null as unknown,
  shells: [] as unknown[],
  pivotState: null as unknown,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: (() => ({ projection: mocks.projection })) as never,
  useThreadRelationshipShells: (() => []) as never,
  useThreadShells: ((enabled = true) => (enabled ? mocks.shells : [])) as never,
  useProjects: (() => []) as never,
}));
vi.mock(import("../../state/pivot"), async (original) => ({
  ...(await original()),
  usePivotState: (() => mocks.pivotState) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => new Map()) as never,
}));
vi.mock(import("../../lib/archivedThreadsState"), async (original) => ({
  ...(await original()),
  useArchivedThreadSnapshots: (() => ({ snapshots: [] })) as never,
}));
vi.mock(import("../../hooks/useNowMinute"), async (original) => ({
  ...(await original()),
  useNowMinute: (() => "2026-10-06T01:05") as never,
}));

import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

const environmentId = EnvironmentId.make("test");

const pivotRecord = (threadId: string): PivotRecord => ({
  threadId: ThreadId.make(threadId),
  projectId: ProjectId.make("project"),
  createdAt: "2026-10-06T00:00:00.000Z",
  retiredAt: null,
  successorThreadId: null,
  openDecisionCount: 0,
  escalatedDecisionCount: 0,
});

const teammateRecord = (
  threadId: string,
  pivotThreadId: string,
  dispatchedAt: string,
  tornDownAt: string | null = null,
): TeammateRecord => ({
  threadId: ThreadId.make(threadId),
  pivotThreadId: ThreadId.make(pivotThreadId),
  projectId: ProjectId.make("project"),
  kind: "ship",
  title: threadId,
  branch: `pivot/${threadId}`,
  report: null,
  resume: null,
  hasEscalatedDecision: false,
  hasScoutReport: false,
  dispatchedAt,
  tornDownAt,
});

const teammateShell = (id: string, status: string, title: string) => ({
  environmentId,
  id: ThreadId.make(id),
  pullRequests: [],
  source: {
    id,
    title,
    status,
    providerInstanceId: "codex",
    lineage: { parentThreadId: null, relationshipToParent: null },
    latestRunId: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    lastError: null,
    usageLimitResetAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
  },
});

const projectionOf = (threadId: string) => ({
  thread: { id: threadId, lineage: { relationshipToParent: null }, activeProviderThreadId: null },
  runs: [],
  providerThreads: [],
  providerSessions: [],
  contextTransfers: [],
  subagents: [],
});

// The mocked hooks are module-level, so every test starts by setting all of them.
function setup(input: { pivotState: PivotState; shells: ReadonlyArray<unknown>; thread: string }) {
  mocks.projection = projectionOf(input.thread);
  mocks.pivotState = input.pivotState;
  mocks.shells = [...input.shells];
}

describe("ThreadRelationshipsPanel in Pivot mode", () => {
  it("lists a Pivot's live teammates under Lineage in dispatch order and leaves settled ones out", async () => {
    setup({
      thread: "pivot",
      pivotState: {
        pivots: { pivot: pivotRecord("pivot") },
        teammates: {
          second: teammateRecord("second", "pivot", "2026-10-06T02:00:00.000Z"),
          first: teammateRecord("first", "pivot", "2026-10-06T01:00:00.000Z"),
          cleaned: teammateRecord(
            "cleaned",
            "pivot",
            "2026-10-06T00:30:00.000Z",
            "2026-10-06T03:00:00.000Z",
          ),
        },
        decisions: {},
      } satisfies PivotState,
      shells: [
        teammateShell("first", "running", "First teammate"),
        teammateShell("second", "completed", "Second teammate"),
        teammateShell("cleaned", "completed", "Cleaned teammate"),
      ],
    });
    await using screen = await render(
      <ThreadRelationshipsPanel environmentId={environmentId} threadId={ThreadId.make("pivot")} />,
    );
    const text = screen.container.textContent ?? "";
    expect(text).toContain("Teammates");
    expect(text).toContain("Working");
    expect(text.indexOf("First teammate")).toBeGreaterThan(-1);
    expect(text.indexOf("First teammate")).toBeLessThan(text.indexOf("Second teammate"));
    expect(text).not.toContain("Cleaned teammate");
  });

  it("lists nothing under another thread's Lineage", async () => {
    setup({
      thread: "plain",
      pivotState: {
        pivots: { pivot: pivotRecord("pivot") },
        teammates: { first: teammateRecord("first", "pivot", "2026-10-06T01:00:00.000Z") },
        decisions: {},
      } satisfies PivotState,
      shells: [teammateShell("first", "running", "First teammate")],
    });
    await using screen = await render(
      <ThreadRelationshipsPanel environmentId={environmentId} threadId={ThreadId.make("plain")} />,
    );
    expect(screen.container.innerHTML).toBe("");
  });
});
