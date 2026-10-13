/**
 * A Pivot gets no browser or device tools: it supervises, and teammates verify.
 * It reads the project and worktrees but writes only its own preferences file.
 *
 * @module PivotToolRestrictions
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadAdmission from "../orchestration-v2/ThreadAdmission.ts";
import * as ThreadToolRestrictions from "../orchestration-v2/ThreadToolRestrictions.ts";
import * as ThreadWriteAccess from "../orchestration-v2/ThreadWriteAccess.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import * as PivotStore from "./PivotStore.ts";

class PivotHomeMissingError extends Schema.TaggedError<PivotHomeMissingError>()(
  "PivotHomeMissingError",
  { threadId: Schema.String },
) {}

class PivotSubagentProjectMissingError extends Schema.TaggedError<PivotSubagentProjectMissingError>()(
  "PivotSubagentProjectMissingError",
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
      // Only the Pivot's own shell merges. A teammate, and any thread delegated under a
      // teammate or a Pivot, is guarded. A lookup that fails guards the thread too.
      withoutForgeMerge: (thread) =>
        Effect.gen(function* () {
          if ((yield* store.getTeammate(thread.id)) !== null) return true;
          const root = thread.lineage.rootThreadId;
          if (root === thread.id) return false;
          return (
            (yield* store.getTeammate(root)) !== null || (yield* store.getPivot(root)) !== null
          );
        }).pipe(Effect.orElseSucceed(() => true)),
    };
  }),
);

// A Pivot's cwd is its home (see PivotThreads.createPivotThread), so the home is the
// thread's worktree. A subagent a Pivot delegates to is not a Pivot, but it copies the
// Pivot's thread, home path included. It runs in the project's checkout with no writes, so
// it reads the project without ever writing to the home or the checkout. Failing a lookup
// fails the run: nothing falls back to full access.
const writeAccess = Layer.effect(
  ThreadWriteAccess.ThreadWriteAccess,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const path = yield* Path.Path;
    return {
      scopeFor: (thread) =>
        store.getPivot(thread.id).pipe(
          Effect.flatMap((pivot) => {
            if (pivot !== null) {
              const home = thread.worktreePath;
              if (home === null)
                return Effect.fail(new PivotHomeMissingError({ threadId: thread.id }));
              return Effect.succeed({
                writableRoots: [home],
                writableFiles: [path.join(home, "preferences.md")],
              });
            }
            const parentId = thread.lineage.parentThreadId;
            if (thread.lineage.relationshipToParent !== "subagent" || parentId === null) {
              return Effect.succeed(null);
            }
            return store.getPivot(parentId).pipe(
              Effect.flatMap((parent) => {
                if (parent === null) return Effect.succeed(null);
                return projects.get(thread.projectId).pipe(
                  Effect.flatMap(
                    Option.match({
                      onNone: () =>
                        Effect.fail(new PivotSubagentProjectMissingError({ threadId: thread.id })),
                      onSome: (project) =>
                        Effect.succeed({
                          writableRoots: [],
                          writableFiles: [],
                          cwd: project.workspaceRoot,
                        }),
                    }),
                  ),
                );
              }),
            );
          }),
        ),
    };
  }),
);

// A teammate is background work: when memory is short it waits for room, one start at a
// time, so the user's own threads are not starved by a batch of teammates.
const admission = Layer.effect(
  ThreadAdmission.ThreadAdmission,
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    const hostStore = yield* PivotHostStore.PivotHostStore;
    return {
      // A teammate this server hosts for another environment's Pivot counts too.
      isBackgroundAgent: (threadId) =>
        Effect.gen(function* () {
          const teammate = yield* store.getTeammate(threadId);
          if (teammate !== null && teammate.tornDownAt === null) return true;
          return yield* hostStore.isLive(threadId);
        }).pipe(Effect.orElseSucceed(() => false)),
    };
  }),
);

export const layer = Layer.mergeAll(toolRestrictions, writeAccess, admission);
