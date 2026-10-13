import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  claudeRuntimeQueryPolicyForRuntimePolicy,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as PivotDatabase from "./PivotDatabase.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotToolRestrictions from "./PivotToolRestrictions.ts";

const projectId = ProjectId.make("project-1");
const pivotThreadId = ThreadId.make("pivot-1");
const teammateThreadId = ThreadId.make("ship-1");
const home = "/home/pivot";
const modelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" };

const thread = (id: ThreadId, worktreePath: string): OrchestrationV2AppThread => {
  const now = DateTime.makeUnsafe("2026-10-13T00:00:00.000Z");
  return {
    createdBy: "user",
    creationSource: "web",
    id,
    projectId,
    title: "Thread",
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    // Both the Pivot and its teammates are created in full access.
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
};

const runtimePolicyLayer = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () => Effect.succeed(undefined),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeed(
          Option.some({
            projectId,
            title: "Project",
            workspaceRoot: "/project-root",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            createdAt: "2026-10-13T00:00:00.000Z",
            updatedAt: "2026-10-13T00:00:00.000Z",
            deletedAt: null,
          }),
        ),
    }),
  ),
);

// A Pivot with one teammate.
const seed = Effect.gen(function* () {
  const store = yield* PivotStore.PivotStore;
  yield* store.dispatch({
    type: "pivot.create",
    threadId: pivotThreadId,
    projectId,
    homePath: home,
    takeover: false,
  });
  yield* store.dispatch({
    type: "teammate.dispatch",
    modelEntry: null,
    pivotThreadId,
    threadId: teammateThreadId,
    projectId,
    kind: "ship",
    title: "Ship",
    branch: "pivot/ship-1",
    baseBranch: "main",
    worktreePath: "/wt/ship-1",
    deliveryMode: "direct-pr",
    intent: "Fix the bug",
    spec: "Fix it",
  });
});

const layer = Layer.mergeAll(
  runtimePolicyLayer,
  PivotToolRestrictions.layer.pipe(
    Layer.provideMerge(Layer.effectDiscard(seed)),
    Layer.provideMerge(PivotStore.layer),
  ),
).pipe(Layer.provide(PivotDatabase.layerMemory), Layer.provideMerge(NodeServices.layer));

const resolve = (id: ThreadId, worktreePath: string) =>
  Effect.gen(function* () {
    const policy = yield* RuntimePolicy.RuntimePolicyV2;
    return yield* policy.resolve({ thread: thread(id, worktreePath), modelSelection });
  });

it.layer(layer)("Pivot and teammate permissions", (it) => {
  it.effect("gives the Pivot the shell while its edits stay on its preferences", () =>
    Effect.gen(function* () {
      const resolved = yield* resolve(pivotThreadId, home);

      assert.equal(resolved.runtimeMode, "full-access");
      // Providers with an OS sandbox confine the shell's writes to the home.
      assert.deepInclude(resolved.sandboxPolicy, { type: "workspaceWrite", writableRoots: [home] });
      assert.deepEqual(resolved.writableFiles, [`${home}/preferences.md`]);

      // Claude cannot sandbox the shell, so only Edit and Write are confined.
      assert.deepEqual(claudeRuntimeQueryPolicyForRuntimePolicy(resolved), {
        permissionMode: "dontAsk",
        tools: ["Read", "Glob", "Grep", "Bash", "TaskOutput", "TaskStop", "Edit", "Write"],
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "Bash",
          "TaskOutput",
          "TaskStop",
          `Edit(/${home}/preferences.md)`,
          `Write(/${home}/preferences.md)`,
        ],
        installPermissionCallback: false,
      });
    }),
  );

  it.effect("runs a teammate with its runtime mode's full access, shell included", () =>
    Effect.gen(function* () {
      const resolved = yield* resolve(teammateThreadId, "/wt/ship-1");

      assert.equal(resolved.runtimeMode, "full-access");
      assert.equal(resolved.sandboxPolicy, undefined);
      assert.equal(resolved.writableFiles, undefined);
      assert.deepEqual(claudeRuntimeQueryPolicyForRuntimePolicy(resolved), {
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        installPermissionCallback: false,
      });
    }),
  );

  // Runs Claude's PreToolUse hook the way the CLI does for a Bash call.
  const bashDecision = (
    role: "pivot" | "teammate",
    command: string,
  ): Promise<{ decision?: string; reason?: string }> => {
    const options = makeClaudeQueryOptions({
      modelSelection,
      nativeThreadId: "native-1",
      resume: false,
      cwd: "/wt/ship-1",
      forgeMergeRole: role,
    });
    const matcher = options.hooks?.PreToolUse?.[0];
    assert.equal(matcher?.matcher, "Bash");
    return matcher!.hooks[0]!(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
        tool_use_id: "tool-1",
      } as never,
      "tool-1",
      { signal: new AbortController().signal },
    ).then((output) => {
      const specific = "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
      return {
        decision: specific?.permissionDecision,
        reason: specific?.permissionDecisionReason,
      } as { decision?: string; reason?: string };
    });
  };

  it.effect("marks the Pivot and its teammates, and nobody else, as barred from merging", () =>
    Effect.gen(function* () {
      assert.equal((yield* resolve(pivotThreadId, home)).forgeMergeRole, "pivot");
      assert.equal((yield* resolve(teammateThreadId, "/wt/ship-1")).forgeMergeRole, "teammate");
      assert.equal(
        (yield* resolve(ThreadId.make("someone-else"), "/elsewhere")).forgeMergeRole,
        undefined,
      );
    }),
  );

  it.effect("refuses a teammate's gh pr merge and forge merge call, naming the Pivot's tool", () =>
    Effect.promise(async () => {
      const viaCli = await bashDecision("teammate", "gh pr merge 12 --squash");
      assert.equal(viaCli.decision, "deny");
      assert.include(viaCli.reason, "merge_teammate");
      const viaApi = await bashDecision(
        "teammate",
        "curl -X PUT https://api.github.com/repos/o/r/pulls/12/merge",
      );
      assert.equal(viaApi.decision, "deny");
    }),
  );

  it.effect("refuses the Pivot's gh pr merge, naming merge_teammate", () =>
    Effect.promise(async () => {
      const refused = await bashDecision("pivot", "gh pr merge 12");
      assert.equal(refused.decision, "deny");
      assert.include(refused.reason, "merge_teammate");
    }),
  );

  it.effect("keeps gh pr create and reading PR state working", () =>
    Effect.promise(async () => {
      for (const role of ["pivot", "teammate"] as const) {
        for (const command of ["gh pr create --fill", "gh pr view 12 --json state", "git push"]) {
          assert.equal((await bashDecision(role, command)).decision, undefined);
        }
      }
    }),
  );
});
