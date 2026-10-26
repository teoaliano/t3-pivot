/**
 * The check every pivotHost call passes, against the real store: who the session says it
 * is, and what the database says the host link allows right now.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthPivotHostScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PivotDatabase from "./PivotDatabase.ts";
import {
  authorize,
  authorizeTeammate,
  type PivotHostCaller,
  PivotHostRefusedError,
} from "./PivotHostAuthorization.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import type { PivotStoreError } from "./PivotStore.ts";

const layer = PivotHostStore.layer.pipe(Layer.provide(PivotDatabase.layerMemory));

const home = EnvironmentId.make("environment-home");
const otherHome = EnvironmentId.make("environment-other-home");
const app = ProjectId.make("project-app");
const docs = ProjectId.make("project-docs");
const secret = ProjectId.make("project-secret");

const callerOf = (grant: PivotHostStore.HostGrant): PivotHostCaller => ({
  subject: grant.subject,
  scopes: [AuthPivotHostScope],
});

const refusal = <A, R>(effect: Effect.Effect<A, PivotHostRefusedError | PivotStoreError, R>) =>
  effect.pipe(
    Effect.catchTags({ PivotStoreError: Effect.die }),
    Effect.flip,
    Effect.map((error) => ({ code: error.code, message: error.message })),
  );

const teammateOf = (grantId: string, threadId: string, projectId: ProjectId) => ({
  threadId: ThreadId.make(threadId),
  grantId,
  dispatchId: `dispatch-${threadId}`,
  projectId,
  pivotThreadId: ThreadId.make("pivot-on-the-home"),
  pivotLabel: "Pivot on Mac",
  kind: "ship" as const,
  title: "Task",
  branch: `pivot/${threadId}`,
  baseBranch: "main",
  worktreePath: `/worktrees/${threadId}`,
  deliveryMode: "local-only" as const,
  firstRunId: null,
  shipDirectly: false,
});

describe("PivotHostAuthorization", () => {
  it.effect("accepts only a session issued by a host link", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const grant = yield* store.createGrant({ allowedProjectIds: [app] });
      assert.deepStrictEqual(
        (yield* authorize(callerOf(grant), { homeEnvironmentId: home })).grantId,
        grant.grantId,
      );

      const notHost = "This session was not issued by a Pivot host link.";
      // Right subject, but the scope was never delegated.
      assert.deepStrictEqual(
        yield* refusal(
          authorize(
            { subject: grant.subject, scopes: [AuthOrchestrationOperateScope] },
            { homeEnvironmentId: home },
          ),
        ),
        { code: "not-authorized", message: notHost },
      );
      // The scope, on a subject no host link issues: a browser, an MCP client, the CLI.
      for (const subject of ["mcp-client", "one-time-token", "pivot-host:", grant.grantId]) {
        assert.deepStrictEqual(
          yield* refusal(
            authorize({ subject, scopes: [AuthPivotHostScope] }, { homeEnvironmentId: home }),
          ),
          { code: "not-authorized", message: notHost },
        );
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a link that does not exist as revoked", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* refusal(
          authorize(
            { subject: "pivot-host:grant-never-made", scopes: [AuthPivotHostScope] },
            { homeEnvironmentId: home },
          ),
        )).code,
        "revoked",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads the allowlist from the database on every call, not from the session", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const grant = yield* store.createGrant({ allowedProjectIds: [app, docs] });
      const caller = callerOf(grant);
      const call = { homeEnvironmentId: home };
      yield* authorize(caller, { ...call, projectId: docs });

      // The same session, a moment later: the edit is already in force.
      yield* store.setAllowlist(grant.grantId, [app]);
      assert.deepStrictEqual(yield* refusal(authorize(caller, { ...call, projectId: docs })), {
        code: "project-not-allowed",
        message:
          "Project project-docs is not allowed on this host link. Allowed projects: project-app.",
      });
      yield* authorize(caller, { ...call, projectId: app });

      yield* store.setAllowlist(grant.grantId, [app, docs]);
      yield* authorize(caller, { ...call, projectId: docs });

      yield* store.setAllowlist(grant.grantId, []);
      assert.strictEqual(
        (yield* refusal(authorize(caller, { ...call, projectId: app }))).message,
        "Project project-app is not allowed: this host link allows no projects.",
      );
      assert.strictEqual(
        (yield* refusal(authorize(caller, { ...call, projectId: secret }))).code,
        "project-not-allowed",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("binds the first home to call, and refuses every other", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const grant = yield* store.createGrant({ allowedProjectIds: [app] });
      assert.isNull(grant.boundHomeEnvironmentId);
      const caller = callerOf(grant);

      yield* authorize(caller, { homeEnvironmentId: home });
      assert.strictEqual((yield* store.getGrant(grant.grantId))?.boundHomeEnvironmentId, home);
      // Not the bound id, and not revealed in the refusal.
      assert.deepStrictEqual(yield* refusal(authorize(caller, { homeEnvironmentId: otherHome })), {
        code: "home-mismatch",
        message: "This Pivot host link belongs to another environment's Pivot.",
      });
      yield* authorize(caller, { homeEnvironmentId: home });
      assert.strictEqual((yield* store.getGrant(grant.grantId))?.boundHomeEnvironmentId, home);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("binds a link once: a second bind leaves the first home in place", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const grant = yield* store.createGrant({ allowedProjectIds: [app] });
      assert.strictEqual(
        (yield* store.bindHome(grant.grantId, home))?.boundHomeEnvironmentId,
        home,
      );
      assert.strictEqual(
        (yield* store.bindHome(grant.grantId, otherHome))?.boundHomeEnvironmentId,
        home,
      );
      assert.strictEqual((yield* store.getGrant(grant.grantId))?.boundHomeEnvironmentId, home);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("binds exactly one of two homes that both read the link unbound", () =>
    Effect.gen(function* () {
      const real = yield* PivotHostStore.PivotHostStore;
      const grant = yield* real.createGrant({ allowedProjectIds: [app] });
      const caller = callerOf(grant);

      // Each caller reads the link, then waits until both have: both see it unbound and go on to
      // bind, which is the interleaving the compare-and-set exists for.
      const bothRead = yield* Deferred.make<void>();
      let reads = 0;
      const interleaved = PivotHostStore.PivotHostStore.of({
        ...real,
        getGrant: (grantId) =>
          real.getGrant(grantId).pipe(
            Effect.tap(() =>
              Effect.gen(function* () {
                if (++reads === 2) yield* Deferred.succeed(bothRead, undefined);
                yield* Deferred.await(bothRead);
              }),
            ),
          ),
      });

      const outcomes = yield* Effect.forEach(
        [home, otherHome],
        (homeEnvironmentId) =>
          authorize(caller, { homeEnvironmentId }).pipe(
            Effect.provideService(PivotHostStore.PivotHostStore, interleaved),
            Effect.map(() => "bound" as const),
            Effect.catchTags({
              PivotHostRefusedError: (error) => Effect.succeed(error.code),
              PivotStoreError: Effect.die,
            }),
          ),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(outcomes.toSorted(), ["bound", "home-mismatch"]);
      const winner = outcomes[0] === "bound" ? home : otherHome;
      assert.strictEqual((yield* real.getGrant(grant.grantId))?.boundHomeEnvironmentId, winner);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "revoking ends access, clears the allowlist and the bound home, and stays revoked",
    () =>
      Effect.gen(function* () {
        const store = yield* PivotHostStore.PivotHostStore;
        const grant = yield* store.createGrant({ allowedProjectIds: [app] });
        const caller = callerOf(grant);
        yield* authorize(caller, { homeEnvironmentId: home });

        assert.isTrue(yield* store.revokeGrant(grant.grantId));
        assert.isFalse(yield* store.revokeGrant(grant.grantId));
        const revoked = (yield* store.getGrant(grant.grantId))!;
        assert.deepStrictEqual(revoked.allowedProjectIds, []);
        assert.isNull(revoked.boundHomeEnvironmentId);
        assert.isNotNull(revoked.revokedAt);
        // Nothing revives it: not another home's call, not an allowlist edit.
        assert.isNull(yield* store.setAllowlist(grant.grantId, [app]));
        // Nor can anything be recorded for it, whatever launched before the revoke.
        assert.isNull(yield* store.recordTeammate(teammateOf(grant.grantId, "thread-late", app)));
        assert.isNull(yield* store.getTeammate(ThreadId.make("thread-late")));
        for (const homeEnvironmentId of [home, otherHome]) {
          assert.strictEqual(
            (yield* refusal(authorize(caller, { homeEnvironmentId }))).code,
            "revoked",
          );
        }
        assert.deepStrictEqual((yield* store.getGrant(grant.grantId))?.allowedProjectIds, []);
        assert.isNull((yield* store.getGrant(grant.grantId))?.boundHomeEnvironmentId);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses another link's teammate and a missing one with the same message", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const mine = yield* store.createGrant({ allowedProjectIds: [app] });
      const theirs = yield* store.createGrant({ allowedProjectIds: [app] });
      yield* store.recordTeammate(teammateOf(theirs.grantId, "thread-theirs", app));
      yield* store.recordTeammate(teammateOf(mine.grantId, "thread-mine", app));
      const call = { homeEnvironmentId: home };

      const found = yield* authorizeTeammate(callerOf(mine), {
        ...call,
        threadId: ThreadId.make("thread-mine"),
      });
      assert.strictEqual(found.teammate.threadId, "thread-mine");

      const foreign = yield* refusal(
        authorizeTeammate(callerOf(mine), { ...call, threadId: ThreadId.make("thread-theirs") }),
      );
      const missing = yield* refusal(
        authorizeTeammate(callerOf(mine), { ...call, threadId: ThreadId.make("thread-nobody") }),
      );
      assert.strictEqual(foreign.code, "teammate-not-found");
      assert.strictEqual(
        foreign.message.replace("thread-theirs", "<id>"),
        missing.message.replace("thread-nobody", "<id>"),
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a link's own teammate once its project leaves the allowlist", () =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const grant = yield* store.createGrant({ allowedProjectIds: [app, docs] });
      yield* store.recordTeammate(teammateOf(grant.grantId, "thread-docs", docs));
      const caller = callerOf(grant);
      const request = { homeEnvironmentId: home, threadId: ThreadId.make("thread-docs") };
      yield* authorizeTeammate(caller, request);

      yield* store.setAllowlist(grant.grantId, [app]);
      assert.strictEqual(
        (yield* refusal(authorizeTeammate(caller, request))).code,
        "teammate-not-found",
      );
      yield* store.setAllowlist(grant.grantId, [app, docs]);
      yield* authorizeTeammate(caller, request);
    }).pipe(Effect.provide(layer)),
  );
});
