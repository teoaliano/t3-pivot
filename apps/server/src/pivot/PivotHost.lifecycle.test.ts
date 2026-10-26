// @effect-diagnostics nodeBuiltinImport:off
/**
 * How a host ends hosted teammates, driven by a fake home: revoking a link, a launch cut
 * short, tearing down, and the live cap. The launching and authorization tests are in
 * PivotHost.test.ts. The two files stay apart because one file holding both made the
 * type checker give up on ws.ts's handler types.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as PivotHost from "./PivotHost.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import {
  addDocsProject,
  discarded,
  docsProjectId,
  flipped,
  hostSetup,
  hostSetupWrapped,
  launch,
  newHome,
  teammates,
} from "./PivotHost.testkit.ts";
import { attachWorktree, modelSelection, projectId, setup } from "./PivotService.testkit.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost } from "./TeammateHost.ts";

describe("revoking a link that has teammates", () => {
  it.effect("stops a teammate recorded just before the revoke commits", () => {
    // A launch finished recording while the revoke was on its way: it is in the link's rows by
    // the time the revoke commits, so the stop covers it.
    const racer: { record: Effect.Effect<void> } = { record: Effect.void };
    const wrapStore = Layer.effect(
      PivotHostStore.PivotHostStore,
      Effect.gen(function* () {
        const real = yield* PivotHostStore.PivotHostStore;
        return PivotHostStore.PivotHostStore.of({
          ...real,
          revokeGrant: (grantId) => racer.record.pipe(Effect.andThen(real.revokeGrant(grantId))),
        });
      }),
    );
    const base = setup();
    const layer = PivotHost.layer.pipe(Layer.provide(wrapStore), Layer.provideMerge(base.layer));
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const real = yield* PivotHostStore.PivotHostStore;
      const teammateHost = yield* TeammateHost;
      const home = yield* newHome();
      const early = yield* launch(home, { dispatchId: "early" });
      racer.record = Effect.gen(function* () {
        const late = yield* teammateHost.launch({
          projectId,
          pivotThreadId: ThreadId.make("pivot-home:pivot-on-the-home"),
          title: "Late",
          kind: "ship",
          intent: "Late work.",
          spec: "Do it.",
          modelSelection,
        });
        yield* real.recordTeammate({
          threadId: late.threadId,
          grantId: home.grantId,
          dispatchId: "late",
          projectId,
          pivotThreadId: ThreadId.make("pivot-on-the-home"),
          pivotLabel: "Pivot on Mac",
          kind: "ship",
          title: "Late",
          branch: late.branch,
          baseBranch: late.baseBranch,
          worktreePath: late.worktreePath,
          deliveryMode: late.deliveryMode,
          firstRunId: late.runId,
          shipDirectly: false,
        });
      }).pipe(Effect.orDie);

      yield* host.revokeGrant(home.grantId);
      assert.deepStrictEqual(
        teammates(base.fake).map((thread) => thread.stops),
        [1, 1],
      );
      assert.strictEqual(teammates(base.fake)[0]!.threadId, early.threadId);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "stops the rest when one stop fails, and a repeat revoke tries the failed one again",
    () => {
      let failing: ThreadId | null = null;
      let failures = 0;
      const wrap = Layer.effect(
        TeammateHost,
        Effect.gen(function* () {
          const real = yield* TeammateHost;
          return TeammateHost.of({
            ...real,
            stop: (threadId) => {
              if (threadId !== failing) return real.stop(threadId);
              failures += 1;
              return failures === 1
                ? Effect.fail(new PivotThreads.PivotThreadsError({ operation: "stop", threadId }))
                : real.stop(threadId);
            },
          });
        }),
      );
      const { fake, layer } = hostSetupWrapped(wrap);
      return Effect.gen(function* () {
        const host = yield* PivotHost.PivotHost;
        const home = yield* newHome();
        const first = yield* launch(home, { dispatchId: "first" });
        const second = yield* launch(home, { dispatchId: "second" });
        failing = first.threadId;
        const stops = () => [first, second].map((ship) => fake.threads.get(ship.threadId)!.stops);

        yield* host.revokeGrant(home.grantId);
        // The failing stop did not keep the other teammate from stopping.
        assert.deepStrictEqual(stops(), [0, 1]);

        yield* host.revokeGrant(home.grantId);
        assert.strictEqual(stops()[0], 1);
      }).pipe(Effect.provide(layer));
    },
  );
});

describe("a launch that is interrupted", () => {
  it.effect("is recorded anyway, since launching and recording cannot be told apart", () => {
    const launched = Deferred.makeUnsafe<void>();
    const wrap = Layer.effect(
      TeammateHost,
      Effect.gen(function* () {
        const real = yield* TeammateHost;
        return TeammateHost.of({
          ...real,
          // The home drops its connection right after the thread was launched.
          launch: (input) =>
            real.launch(input).pipe(
              Effect.tap(() => Deferred.succeed(launched, undefined)),
              Effect.tap(() => Effect.yieldNow),
            ),
        });
      }),
    );
    const { fake, layer } = hostSetupWrapped(wrap);
    return Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome();
      const fiber = yield* launch(home).pipe(Effect.forkChild);
      yield* Deferred.await(launched);
      yield* Fiber.interrupt(fiber);

      // No thread runs unrecorded: it has its record, so the cap counts it and a revoke finds it.
      const record = yield* store.findByDispatch(home.grantId, "dispatch-1");
      assert.isNotNull(record);
      assert.lengthOf(teammates(fake), 1);
      assert.strictEqual(teammates(fake)[0]!.threadId, record!.threadId);
      assert.strictEqual(yield* store.countLive(home.grantId), 1);
      // And a retry finds it rather than launching a second.
      assert.strictEqual((yield* launch(home)).threadId, record!.threadId);
      assert.lengthOf(teammates(fake), 1);
    }).pipe(Effect.provide(layer));
  });
});

describe("tearing down a hosted teammate", () => {
  it.effect("refuses a dirty worktree before stopping anything, unless forced", () => {
    const { fake, workspaceRoot, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const worktree = attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);
      NodeFS.writeFileSync(NodePath.join(worktree, "wip.txt"), "unsaved\n");
      const call = { ...home.call, threadId: ship.threadId };
      const thread = fake.threads.get(ship.threadId)!;

      const refused = yield* flipped(host.teardown(home.caller, { ...call, force: false }));
      assert.strictEqual(refused.code, "worktree-not-clean");
      assert.include(refused.message, "uncommitted changes");
      assert.strictEqual(thread.stops, 0);
      assert.isFalse(thread.archived);
      assert.deepStrictEqual(fake.removedWorktrees, []);
      assert.isNull((yield* store.getTeammate(ship.threadId))?.tornDownAt);

      yield* host.teardown(home.caller, { ...call, force: true });
      assert.strictEqual(thread.stops, 1);
      assert.deepStrictEqual(fake.removedWorktrees, [{ worktreePath: worktree, force: true }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("tears down a clean worktree without force", () => {
    const { fake, workspaceRoot, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);
      yield* host.teardown(home.caller, { ...home.call, threadId: ship.threadId, force: false });
      assert.isTrue(fake.threads.get(ship.threadId)!.archived);
    }).pipe(Effect.provide(layer));
  });
});

describe("the live cap under concurrent launches", () => {
  it.effect("lets only one of two launches into different projects take the last place", () => {
    // Both launches pass the early count and launch; only the insert, under the store's one
    // writer, decides which gets the last place.
    let armed = false;
    let launches = 0;
    const bothLaunched = Deferred.makeUnsafe<void>();
    const wrap = Layer.effect(
      TeammateHost,
      Effect.gen(function* () {
        const real = yield* TeammateHost;
        return TeammateHost.of({
          ...real,
          launch: (input) =>
            real.launch(input).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  if (!armed) return;
                  if (++launches === 2) yield* Deferred.succeed(bothLaunched, undefined);
                  yield* Deferred.await(bothLaunched);
                }),
              ),
            ),
        });
      }),
    );
    const { fake, layer } = hostSetupWrapped(wrap);
    addDocsProject(fake);
    return Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome([projectId, docsProjectId]);
      for (let index = 0; index < PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES - 1; index++) {
        yield* launch(home, { dispatchId: `dispatch-${index}` });
      }
      armed = true;
      const outcomes = yield* Effect.forEach(
        [projectId, docsProjectId],
        (id) =>
          launch(home, { projectId: id, dispatchId: `last-${id}` }).pipe(
            Effect.map(() => "launched" as const),
            Effect.catchTags({
              PivotRefusedError: (error) => Effect.succeed(error.message),
              PivotHostRefusedError: (error) => Effect.succeed(error.message),
            }),
          ),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(outcomes.toSorted(), [
        `This host link already runs ${PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES} teammates, the most it may. Tear one down first.`,
        "launched",
      ]);
      assert.strictEqual(
        yield* store.countLive(home.grantId),
        PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES,
      );
      // The one that lost left no running thread behind.
      const loser = teammates(fake).filter((thread) => thread.archived);
      assert.deepStrictEqual(loser.map(discarded), [[true, 1, 1]]);
    }).pipe(Effect.provide(layer));
  });
});
