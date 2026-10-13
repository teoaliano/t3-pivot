/**
 * A Pivot gets no browser or device tools: it supervises, and teammates verify.
 * It reads the project and worktrees but writes only its own preferences file.
 *
 * @module PivotToolRestrictions
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ThreadToolRestrictions from "../orchestration-v2/ThreadToolRestrictions.ts";
import * as ThreadWriteAccess from "../orchestration-v2/ThreadWriteAccess.ts";
import * as PivotStore from "./PivotStore.ts";

class PivotHomeMissingError extends Schema.TaggedError<PivotHomeMissingError>()(
  "PivotHomeMissingError",
  { threadId: Schema.String },
) {}

const toolRestrictions = Layer.effect(
  ThreadToolRestrictions.ThreadToolRestrictions,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return {
      withoutBrowserOrDevice: (threadId) =>
        store.getPivot(threadId).pipe(
          Effect.map((pivot) => pivot !== null),
          Effect.orElseSucceed(() => false),
        ),
      // A lookup that fails guards the thread rather than leaving its shell open.
      forgeMergeRole: (threadId) =>
        Effect.gen(function* () {
          if ((yield* store.getPivot(threadId)) !== null) return "pivot" as const;
          if ((yield* store.getTeammate(threadId)) !== null) return "teammate" as const;
          return null;
        }).pipe(Effect.orElseSucceed(() => "teammate" as const)),
    };
  }),
);

// A Pivot's cwd is its home (see PivotThreads.createPivotThread), so the home is the
// thread's worktree. Failing the lookup fails the run: a Pivot never falls back to full access.
const writeAccess = Layer.effect(
  ThreadWriteAccess.ThreadWriteAccess,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    const path = yield* Path.Path;
    return {
      scopeFor: (thread) =>
        store.getPivot(thread.id).pipe(
          Effect.flatMap((pivot) => {
            if (pivot === null) return Effect.succeed(null);
            const home = thread.worktreePath;
            if (home === null)
              return Effect.fail(new PivotHomeMissingError({ threadId: thread.id }));
            return Effect.succeed({
              writableRoots: [home],
              writableFiles: [path.join(home, "preferences.md")],
            });
          }),
        ),
    };
  }),
);

export const layer = Layer.mergeAll(toolRestrictions, writeAccess);
