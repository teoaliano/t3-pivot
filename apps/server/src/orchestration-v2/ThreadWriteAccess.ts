/**
 * ThreadWriteAccess - threads whose agent may write only inside a given scope.
 *
 * The default scope is null: the thread runs with its runtime mode's own access. T3
 * Pivot provides a scope so a Pivot can read the project and worktrees but write only
 * to its own home. A lookup failure fails the run rather than falling back to full access.
 *
 * @module ThreadWriteAccess
 */
import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface ThreadWriteScope {
  /** Directories the agent may write under, for providers with directory sandboxes. */
  readonly writableRoots: ReadonlyArray<string>;
  /** The only files the agent may edit, for providers that scope edits by file. */
  readonly writableFiles: ReadonlyArray<string>;
}

export class ThreadWriteAccess extends Context.Reference<{
  readonly scopeFor: (
    thread: OrchestrationV2AppThread,
  ) => Effect.Effect<ThreadWriteScope | null, unknown>;
}>("t3/orchestration-v2/ThreadWriteAccess", {
  defaultValue: () => ({ scopeFor: () => Effect.succeed(null) }),
}) {}
