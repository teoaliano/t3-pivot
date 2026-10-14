// @effect-diagnostics nodeBuiltinImport:off
/**
 * What a host runs for another environment's Pivot, driven by a fake home: a client that
 * holds one host link's session. The real PivotHost, store, git and TeammateHost run over
 * a fake V2.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type PivotHostEvent,
  ProjectId,
  type RepositoryIdentity,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { RestartCarryOn } from "../orchestration-v2/RestartCarryOn.ts";
import * as PivotCarryOn from "./PivotCarryOn.ts";
import * as PivotHost from "./PivotHost.ts";
import type { PivotHostServiceError } from "./PivotHost.ts";
import { callerOfSession, PivotHostRefusedError } from "./PivotHostAuthorization.ts";
import * as PivotDatabase from "./PivotDatabase.ts";
import * as PivotHostStore from "./PivotHostStore.ts";
import {
  addDocsProject,
  discarded,
  docsProjectId,
  type FakeHome,
  flipped,
  hostSetup,
  hostSetupWrapped,
  launch,
  launchInput,
  newHome,
  otherHomeEnvironmentId,
  teammates,
} from "./PivotHost.testkit.ts";
import * as PivotService from "./PivotService.ts";
import { attachWorktree, modelSelection, projectId, setup, sh } from "./PivotService.testkit.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotSupervisor from "./PivotSupervisor.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost } from "./TeammateHost.ts";

const acmeApp = {
  canonicalKey: "github.com/acme/app",
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@github.com:acme/app" },
} satisfies RepositoryIdentity;

/** Every method that targets one hosted teammate, as a thunk for a given session. */
const teammateCalls = (home: FakeHome, threadId: ThreadId) =>
  Effect.gen(function* () {
    const host = yield* PivotHost.PivotHost;
    const call = { ...home.call, threadId };
    const pullRequest = { ...call, repository: "acme/app", number: 7 };
    return [
      ["send", () => host.send(home.caller, { ...call, text: "Hello." })],
      ["stop", () => host.stop(home.caller, call)],
      ["relaunch", () => host.relaunch(home.caller, { ...call, text: "Again." })],
      ["retryLaunch", () => host.retryLaunch(home.caller, call)],
      ["settle", () => host.settle(home.caller, call)],
      ["teardown", () => host.teardown(home.caller, { ...call, force: false })],
      ["pullRequestDetail", () => host.pullRequestDetail(home.caller, pullRequest)],
      [
        "mergePullRequest",
        () => host.mergePullRequest(home.caller, { ...pullRequest, expectedHeadSha: "abc" }),
      ],
      ["land", () => host.land(home.caller, call)],
    ] as const satisfies ReadonlyArray<
      readonly [string, () => Effect.Effect<unknown, PivotHostServiceError>]
    >;
  });

describe("PivotHost launching", () => {
  it.effect("records the hosted teammate before its first run starts", () => {
    // The service harness alone: the observed PivotHost below must be the only one.
    const { layer: base } = setup();
    const seenAtStart: Array<boolean> = [];
    // PivotHost sees the seam through a wrapper that notes, as the first run is awaited,
    // whether the teammate is already recorded.
    const observed = Layer.effect(
      TeammateHost,
      Effect.gen(function* () {
        const real = yield* TeammateHost;
        const store = yield* PivotHostStore.PivotHostStore;
        return TeammateHost.of({
          ...real,
          awaitStart: (threadId, runId) =>
            store.getTeammate(threadId).pipe(
              Effect.tap((recorded) => Effect.sync(() => seenAtStart.push(recorded !== null))),
              Effect.andThen(real.awaitStart(threadId, runId)),
            ),
        });
      }),
    );
    const layer = PivotHost.layer.pipe(Layer.provide(observed), Layer.provideMerge(base));
    return Effect.gen(function* () {
      const home = yield* newHome();
      const launched = yield* launch(home);
      assert.deepStrictEqual(seenAtStart, [true]);
      assert.strictEqual(launched.firstRun, "started");
      assert.match(launched.branch, /^pivot\/fix-the-login-bug/);
      assert.strictEqual(launched.deliveryMode, "local-only");

      const store = yield* PivotHostStore.PivotHostStore;
      const record = yield* store.getTeammate(launched.threadId);
      assert.strictEqual(record?.grantId, home.grantId);
      assert.strictEqual(record?.dispatchId, "dispatch-1");
      assert.strictEqual(record?.pivotLabel, "Pivot on Mac");
      assert.strictEqual(record?.worktreePath, launched.worktreePath);
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends the brief as the first message, from the home's Pivot", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const home = yield* newHome();
      const launched = yield* launch(home, { pivotThreadId: ThreadId.make("pivot-on-mac") });
      const [first] = fake.threads.get(launched.threadId)!.messages;
      // The home's thread id is namespaced: it is the home's, not a thread of this host.
      assert.strictEqual(
        first?.senderThreadId,
        PivotHost.hostedSenderOf(ThreadId.make("pivot-on-mac")),
      );
      assert.include(first?.text, "Make the login button work on Safari.");
      assert.include(first?.text, launched.branch);
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns the same teammate for a retried dispatch, and launches once", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const home = yield* newHome();
      const first = yield* launch(home);
      const retried = yield* launch(home);
      assert.deepStrictEqual(retried, first);
      assert.lengthOf(teammates(fake), 1);

      // Two copies of the request arriving together make one teammate as well.
      const [a, b] = yield* Effect.all(
        [launch(home, { dispatchId: "dispatch-2" }), launch(home, { dispatchId: "dispatch-2" })],
        { concurrency: "unbounded" },
      );
      assert.strictEqual(a.threadId, b.threadId);
      assert.notStrictEqual(a.threadId, first.threadId);
      assert.lengthOf(teammates(fake), 2);

      // A dispatchId belongs to the link that made it.
      const other = yield* newHome([projectId], otherHomeEnvironmentId);
      const theirs = yield* launch(other);
      assert.notStrictEqual(theirs.threadId, first.threadId);
      assert.lengthOf(teammates(fake), 3);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses to reuse a dispatchId for another project or after teardown", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome([projectId, docsProjectId]);
      const first = yield* launch(home);
      assert.deepStrictEqual(yield* flipped(launch(home, { projectId: docsProjectId })), {
        code: "PivotRefusedError",
        message: "That dispatchId was used for a different launch.",
      });
      yield* host.teardown(home.caller, { ...home.call, threadId: first.threadId, force: false });
      assert.strictEqual(
        (yield* flipped(launch(home))).message,
        "The teammate that dispatch launched was torn down.",
      );
      assert.lengthOf(teammates(fake), 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("never lets the home's Pivot thread id read as a thread of the host's own", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const { threadId: localPivot } = yield* pivots.create({
        projectId,
        modelSelection,
        takeover: false,
      });
      const home = yield* newHome();
      // The same launch whether or not the id names a thread here: nothing to probe with.
      const launched = yield* launch(home, { pivotThreadId: localPivot });
      const [first] = fake.threads.get(launched.threadId)!.messages;
      assert.notStrictEqual(first?.senderThreadId, localPivot);
      assert.strictEqual(first?.senderThreadId, `pivot-home:${localPivot}`);
      assert.isUndefined(fake.threads.get(first!.senderThreadId!));
    }).pipe(Effect.provide(layer));
  });

  it.effect("launches only in projects on the allowlist, and names them in the refusal", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const home = yield* newHome([docsProjectId]);
      assert.deepStrictEqual(yield* flipped(launch(home)), {
        code: "project-not-allowed",
        message:
          "Project project-1 is not allowed on this host link. Allowed projects: project-docs.",
      });
      assert.lengthOf(teammates(fake), 0);
      yield* launch(home, { projectId: docsProjectId });
      assert.lengthOf(teammates(fake), 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("archives a launched thread whose record could not be written", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const home = yield* newHome();
      // A launch with no run cannot be recorded; the thread it made is archived.
      fake.nextLaunch = {
        worktreePath: null,
        start: { type: "failed", runId: null, detail: "No run." },
      };
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const exit = yield* Effect.exit(host.launchTeammate(home.caller, launchInput(home)));
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(teammates(fake).map(discarded), [[true, 1, 1]]);
      assert.isNull(yield* store.findByDispatch(home.grantId, "dispatch-1"));
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotHost authorization", () => {
  it.effect("refuses every teammate-targeting method on another link's teammate", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const mine = yield* newHome();
      const theirs = yield* newHome([projectId], otherHomeEnvironmentId);
      const hers = yield* launch(theirs);
      const missing = ThreadId.make("thread-nobody");
      for (const [method, run] of yield* teammateCalls(mine, hers.threadId)) {
        const foreign = yield* flipped(run());
        const absent = yield* flipped(
          (yield* teammateCalls(mine, missing)).find(([name]) => name === method)![1](),
        );
        assert.strictEqual(foreign.code, "teammate-not-found", method);
        assert.strictEqual(
          foreign.message.replace(hers.threadId, "<id>"),
          absent.message.replace(missing, "<id>"),
          method,
        );
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("applies an allowlist edit to a session that is already open", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome([projectId, docsProjectId]);
      const ship = yield* launch(home);
      const calls = yield* teammateCalls(home, ship.threadId);

      // Open: the session works.
      yield* host.send(home.caller, { ...home.call, threadId: ship.threadId, text: "Go on." });

      yield* host.setGrantAllowlist(home.grantId, [docsProjectId]);
      for (const [method, run] of calls) {
        assert.strictEqual((yield* flipped(run())).code, "teammate-not-found", method);
      }
      assert.strictEqual((yield* flipped(launch(home))).code, "project-not-allowed");
      assert.deepStrictEqual(
        (yield* host.describe(home.caller, home.call)).projects.map((p) => p.projectId),
        [docsProjectId],
      );

      // Allowed again: the same session works again, with nothing re-issued.
      yield* host.setGrantAllowlist(home.grantId, [projectId]);
      yield* host.send(home.caller, { ...home.call, threadId: ship.threadId, text: "Again." });
    }).pipe(Effect.provide(layer));
  });

  it.effect("ends every method once the link is revoked, and clears what it held", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      yield* host.revokeGrant(home.grantId);

      for (const [method, run] of yield* teammateCalls(home, ship.threadId)) {
        assert.strictEqual((yield* flipped(run())).code, "revoked", method);
      }
      assert.strictEqual((yield* flipped(host.describe(home.caller, home.call))).code, "revoked");
      assert.strictEqual((yield* flipped(launch(home))).code, "revoked");
      const events = host
        .events(home.caller, { ...home.call, afterSequence: 0 })
        .pipe(Stream.runCollect);
      assert.strictEqual((yield* flipped(events)).code, "revoked");

      const [grant] = yield* host.listGrants;
      assert.deepStrictEqual(grant?.allowedProjectIds, []);
      assert.isNull(grant?.boundHomeEnvironmentId);
      // The link's teammates stop being live: they are stopped, and a restart does not resume them.
      const store = yield* PivotHostStore.PivotHostStore;
      assert.isFalse(yield* store.isLive(ship.threadId));
    }).pipe(Effect.provide(layer));
  });

  it.effect("binds the first home to call and refuses a second one on every method", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const impostor: FakeHome = { ...home, call: { homeEnvironmentId: otherHomeEnvironmentId } };
      for (const [method, run] of yield* teammateCalls(impostor, ship.threadId)) {
        assert.strictEqual((yield* flipped(run())).code, "home-mismatch", method);
      }
      assert.strictEqual(
        (yield* flipped(host.describe(impostor.caller, impostor.call))).code,
        "home-mismatch",
      );
      assert.strictEqual((yield* flipped(launch(impostor))).code, "home-mismatch");
      // The real home is unaffected.
      yield* host.describe(home.caller, home.call);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses sessions that no host link issued", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const call = home.call;
      const sessions = [
        { subject: home.caller.subject, scopes: [] },
        { subject: "mcp-client", scopes: ["pivot:host" as const] },
        { subject: "cli-issued-session", scopes: ["orchestration:operate" as const] },
      ];
      for (const caller of sessions) {
        assert.strictEqual((yield* flipped(host.describe(caller, call))).code, "not-authorized");
        assert.strictEqual(
          (yield* flipped(host.launchTeammate(caller, launchInput(home)))).code,
          "not-authorized",
        );
      }
      assert.lengthOf((yield* host.listGrants)[0]!.allowedProjectIds, 1);
      assert.isNull((yield* host.listGrants)[0]!.boundHomeEnvironmentId);
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotHost describe", () => {
  it.effect(
    "lists only allowed projects, grouped as the home matches them, with host models",
    () => {
      const { fake, layer } = hostSetup({
        remote: true,
        settings: {
          teammateModels: [
            {
              name: "fast",
              modelSelection,
              description: "Quick.",
              isDefault: true,
            },
          ],
        },
      });
      const identity = {
        canonicalKey: "github.com/acme/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "git@github.com:acme/app",
        },
        origin: { canonicalKey: "github.com/me/app-fork" },
      } satisfies RepositoryIdentity;
      fake.projects.set(projectId, {
        ...fake.projects.get(projectId)!,
        title: "App",
        repositoryIdentity: identity,
      });
      addDocsProject(fake);
      const secret = ProjectId.make("project-secret");
      fake.projects.set(secret, { ...fake.projects.get(docsProjectId)!, projectId: secret });
      return Effect.gen(function* () {
        const host = yield* PivotHost.PivotHost;
        const home = yield* newHome([docsProjectId, projectId]);
        const described = yield* host.describe(home.caller, home.call);
        assert.deepStrictEqual(
          described.projects.map((project) => [
            project.projectId,
            project.title,
            project.repositoryKey,
            project.hasRemote,
          ]),
          [
            [docsProjectId, "Docs", null, false],
            [projectId, "App", "github.com/me/app-fork", true],
          ],
        );
        assert.deepStrictEqual(
          described.teammateModels.map((entry) => entry.name),
          ["fast"],
        );
        assert.deepStrictEqual(
          described.projects[1]?.teammateModels.map((entry) => entry.name),
          ["fast"],
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("skips an allowed project that is gone or is not a git repository", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const plain = ProjectId.make("project-plain");
      fake.projects.set(plain, {
        ...fake.projects.get(projectId)!,
        projectId: plain,
        workspaceRoot: NodeFS.mkdtempSync(NodePath.join(NodeFS.realpathSync("/tmp"), "t3-plain-")),
      });
      const home = yield* newHome([projectId, plain]);
      fake.projects.delete(projectId);
      assert.deepStrictEqual((yield* host.describe(home.caller, home.call)).projects, []);
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotHost teammate control", () => {
  it.effect("sends as the home's Pivot, stops, relaunches, retries a launch and settles", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home, { pivotThreadId: ThreadId.make("pivot-on-mac") });
      const thread = fake.threads.get(ship.threadId)!;
      const call = { ...home.call, threadId: ship.threadId };

      yield* host.send(home.caller, { ...call, text: "Use the Safari build." });
      assert.deepStrictEqual(thread.messages.at(-1), {
        senderThreadId: PivotHost.hostedSenderOf(ThreadId.make("pivot-on-mac")),
        text: "Use the Safari build.",
        mode: "queue",
      });

      yield* host.stop(home.caller, call);
      assert.strictEqual(thread.stops, 1);

      const relaunched = yield* host.relaunch(home.caller, { ...call, text: "Carry on." });
      assert.strictEqual(relaunched.outcome, "started");
      assert.strictEqual(thread.messages.at(-1)?.mode, "relaunch");
      assert.strictEqual(
        thread.messages.at(-1)?.senderThreadId,
        PivotHost.hostedSenderOf(ThreadId.make("pivot-on-mac")),
      );

      fake.nextRelaunch = { type: "failed", runId: null, detail: "Setup failed." };
      assert.deepStrictEqual(yield* host.retryLaunch(home.caller, call), {
        outcome: "failed",
        runId: null,
        detail: "Setup failed.",
      });

      yield* host.settle(home.caller, call);
      assert.isTrue(thread.settled);
    }).pipe(Effect.provide(layer));
  });

  it.effect("tears down, removes the worktree, and answers a repeat without acting twice", () => {
    const { fake, workspaceRoot, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const worktree = attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);
      const call = { ...home.call, threadId: ship.threadId };

      yield* host.teardown(home.caller, { ...call, force: true });
      assert.deepStrictEqual(fake.removedWorktrees, [{ worktreePath: worktree, force: true }]);
      assert.isTrue(fake.threads.get(ship.threadId)!.archived);
      assert.isNotNull((yield* store.getTeammate(ship.threadId))?.tornDownAt);
      assert.isFalse(yield* store.isLive(ship.threadId));

      yield* host.teardown(home.caller, { ...call, force: true });
      assert.lengthOf(fake.removedWorktrees, 1);
      // A torn-down teammate takes no more orders.
      assert.strictEqual(
        (yield* flipped(host.send(home.caller, { ...call, text: "Hello?" }))).message,
        `Teammate ${ship.threadId} was torn down.`,
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads and merges only pull requests linked to the teammate's own thread", () => {
    const { fake, layer } = hostSetup({ remote: true });
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      fake.projects.set(projectId, {
        ...fake.projects.get(projectId)!,
        repositoryIdentity: acmeApp,
      });
      const url = "https://github.com/acme/app/pull/7";
      fake.threads.get(ship.threadId)!.shell = {
        pullRequests: [{ url, host: "github.com", repository: "acme/app", number: 7 }],
      } as never;
      fake.pullRequests.set(url, { headSha: "abc123", state: "open" });
      const call = { ...home.call, threadId: ship.threadId, repository: "acme/app" };

      const detail = yield* host.pullRequestDetail(home.caller, { ...call, number: 7 });
      assert.strictEqual(detail.headSha, "abc123");
      // Another PR of the same repository is not this teammate's to read or merge.
      fake.pullRequests.set("https://github.com/acme/app/pull/8", { headSha: "def456" });
      for (const run of [
        host.pullRequestDetail(home.caller, { ...call, number: 8 }),
        host.mergePullRequest(home.caller, { ...call, number: 8, expectedHeadSha: "def456" }),
      ]) {
        assert.strictEqual(
          (yield* flipped(run)).message,
          "That pull request is not linked to this teammate.",
        );
      }
      assert.deepStrictEqual(fake.merges, []);

      yield* host.mergePullRequest(home.caller, { ...call, number: 7, expectedHeadSha: "abc123" });
      assert.deepStrictEqual(fake.merges, [{ url, expectedHeadSha: "abc123" }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("lands a local-only teammate's committed work on the host's default branch", () => {
    const { fake, workspaceRoot, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const worktree = attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);
      const call = { ...home.call, threadId: ship.threadId };

      NodeFS.writeFileSync(NodePath.join(worktree, "login.txt"), "fixed\n");
      assert.strictEqual((yield* host.land(home.caller, call))._tag, "refused");

      sh(worktree, "git add -A && git commit -q -m fix");
      const landed = yield* host.land(home.caller, call);
      assert.strictEqual(landed._tag, "landed");
      assert.strictEqual(
        sh(workspaceRoot, "git rev-parse main"),
        sh(worktree, "git rev-parse HEAD"),
      );
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotHost log", () => {
  const report = (threadId: ThreadId, summary: string) =>
    Effect.flatMap(PivotService.PivotService, (pivots) =>
      pivots.reportStatus(threadId, { status: "working", summary }),
    );

  it.effect("replays from a cursor in order, and only this link's entries", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const mine = yield* newHome();
      const theirs = yield* newHome([projectId], otherHomeEnvironmentId);
      const ship = yield* launch(mine);
      const hers = yield* launch(theirs);
      yield* report(ship.threadId, "one");
      yield* report(hers.threadId, "not for the first home");
      yield* report(ship.threadId, "two");
      yield* report(ship.threadId, "three");

      const read = (home: FakeHome, afterSequence: number, count: number) =>
        host.events(home.caller, { ...home.call, afterSequence }).pipe(
          Stream.take(count),
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk)),
        );
      const summaries = (events: ReadonlyArray<PivotHostEvent>) =>
        events.map((entry) => (entry.event._tag === "reported" ? entry.event.summary : "?"));

      const all = yield* read(mine, 0, 3);
      assert.deepStrictEqual(summaries(all), ["one", "two", "three"]);
      assert.isTrue(all.every((entry) => entry.threadId === ship.threadId));
      assert.deepStrictEqual(
        all.map((entry) => entry.sequence),
        all.map((entry) => entry.sequence).toSorted((a, b) => a - b),
      );
      // From the middle: a cursor is the last sequence already applied.
      assert.deepStrictEqual(summaries(yield* read(mine, all[0]!.sequence, 2)), ["two", "three"]);
      assert.deepStrictEqual(summaries(yield* read(theirs, 0, 1)), ["not for the first home"]);
    }).pipe(Effect.provide(layer));
  });

  /** Runs the stream's consumer in the background and collects what it delivers. */
  const collecting = (home: FakeHome) =>
    Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const seen: Array<PivotHostEvent> = [];
      const waiting: Array<{ readonly count: number; readonly reached: Deferred.Deferred<void> }> =
        [];
      const fiber = yield* host.events(home.caller, { ...home.call, afterSequence: 0 }).pipe(
        Stream.runForEach((entry) =>
          Effect.gen(function* () {
            seen.push(entry);
            for (const wait of waiting) {
              if (seen.length === wait.count) yield* Deferred.succeed(wait.reached, undefined);
            }
          }),
        ),
        Effect.forkChild,
      );
      /** Resolves once `count` entries have been delivered. */
      const untilSeen = (count: number) =>
        Effect.gen(function* () {
          const reached = yield* Deferred.make<void>();
          waiting.push({ count, reached });
          if (seen.length >= count) yield* Deferred.succeed(reached, undefined);
          yield* Deferred.await(reached);
        });
      return { seen, fiber, untilSeen };
    });

  /** The stream's fiber must finish on its own: a stream that never ends fails here, not by hanging. */
  const endsOnItsOwn = (fiber: Fiber.Fiber<void, PivotHostServiceError>) =>
    Effect.gen(function* () {
      const bounded = yield* Fiber.join(fiber).pipe(
        Effect.timeoutOption("5 seconds"),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 seconds");
      assert.isTrue(Option.isSome(yield* Fiber.join(bounded)), "the stream did not end");
    });

  it.effect("streams new entries as they are appended, and ends when the link is revoked", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      yield* report(ship.threadId, "before");

      const { seen, fiber, untilSeen } = yield* collecting(home);
      yield* report(ship.threadId, "during");
      yield* report(ship.threadId, "later");
      yield* untilSeen(3);

      yield* host.revokeGrant(home.grantId);
      yield* endsOnItsOwn(fiber);
      assert.deepStrictEqual(
        seen.map((entry) => (entry.event._tag === "reported" ? entry.event.summary : "?")),
        ["before", "during", "later"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("delivers only entries of allowed projects, in order, between others", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome([projectId, docsProjectId]);
      const app = yield* launch(home);
      const docs = yield* launch(home, { dispatchId: "dispatch-2", projectId: docsProjectId });
      yield* report(app.threadId, "app one");
      yield* report(docs.threadId, "docs");
      yield* report(app.threadId, "app two");
      yield* host.setGrantAllowlist(home.grantId, [projectId]);

      const events = yield* host
        .events(home.caller, { ...home.call, afterSequence: 0 })
        .pipe(Stream.take(2), Stream.runCollect);
      assert.deepStrictEqual(
        Array.from(events).map((entry) => [
          entry.threadId,
          entry.event._tag === "reported" ? entry.event.summary : "?",
        ]),
        [
          [app.threadId, "app one"],
          [app.threadId, "app two"],
        ],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("stops delivering a project's entries once it leaves the allowlist mid-stream", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome([projectId, docsProjectId]);
      const app = yield* launch(home);
      const docs = yield* launch(home, { dispatchId: "dispatch-2", projectId: docsProjectId });
      const { seen, fiber, untilSeen } = yield* collecting(home);
      yield* report(docs.threadId, "docs while allowed");
      yield* untilSeen(1);

      yield* host.setGrantAllowlist(home.grantId, [projectId]);
      // Its teammate is stopped and no longer live, so its report is refused outright.
      yield* Effect.flip(report(docs.threadId, "docs after"));
      yield* report(app.threadId, "app after");
      yield* untilSeen(2);
      yield* host.revokeGrant(home.grantId);
      yield* endsOnItsOwn(fiber);
      assert.deepStrictEqual(
        seen.map((entry) => (entry.event._tag === "reported" ? entry.event.summary : "?")),
        ["docs while allowed", "app after"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("replays past one page in order, with no gap and no repeat", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const total = PivotHost.EVENTS_PAGE * 2 + 5;
      for (let index = 0; index < total; index++) {
        yield* store.appendEvent({
          threadId: ship.threadId,
          event: { _tag: "user-message", text: `message ${index}` },
        });
      }
      const read = (afterSequence: number, count: number) =>
        host.events(home.caller, { ...home.call, afterSequence }).pipe(
          Stream.take(count),
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk)),
        );
      const text = (entry: PivotHostEvent) =>
        entry.event._tag === "user-message" ? entry.event.text : "?";

      const all = yield* read(0, total);
      assert.deepStrictEqual(
        all.map(text),
        Array.from({ length: total }, (_, index) => `message ${index}`),
      );
      assert.strictEqual(new Set(all.map((entry) => entry.sequence)).size, total);
      const middle = PivotHost.EVENTS_PAGE + 17;
      const rest = yield* read(all[middle - 1]!.sequence, total - middle);
      assert.deepStrictEqual(rest.map(text), all.slice(middle).map(text));
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "holds a link to a few events streams at once, and frees a place when one closes",
    () => {
      const { layer } = hostSetup();
      return Effect.gen(function* () {
        const host = yield* PivotHost.PivotHost;
        const home = yield* newHome();
        const open = () =>
          host
            .events(home.caller, { ...home.call, afterSequence: 0 })
            .pipe(Stream.runDrain, Effect.forkChild);
        const streams = [];
        for (let index = 0; index < PivotHost.PIVOT_HOST_MAX_EVENT_STREAMS; index++) {
          streams.push(yield* open());
          // Each stream has registered once it has taken its first look at the log.
          yield* Effect.yieldNow;
        }
        const refused = yield* flipped(
          host.events(home.caller, { ...home.call, afterSequence: 0 }).pipe(Stream.runDrain),
        );
        assert.deepStrictEqual(refused, {
          code: "PivotRefusedError",
          message: `This host link already has ${PivotHost.PIVOT_HOST_MAX_EVENT_STREAMS} events streams open, the most it may.`,
        });

        yield* Fiber.interrupt(streams[0]!);
        const replacement = yield* open();
        yield* Effect.yieldNow;
        yield* host.revokeGrant(home.grantId);
        yield* Effect.forEach([...streams.slice(1), replacement], Fiber.join, { discard: true });
      }).pipe(Effect.provide(layer));
    },
  );
});

describe("hosted teammate tools", () => {
  it.effect("accepts report_status, logs it, and opens no decision and wakes nobody", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const home = yield* newHome();
      const ship = yield* launch(home);
      fake.threads.get(ship.threadId)!.shell = { latestRunId: RunId.make("run-7") };

      const result = yield* pivots.reportStatus(ship.threadId, {
        status: "needs-decision",
        summary: "Which browser first?",
        decisionKey: "browser",
      });
      assert.deepStrictEqual(result, { status: "needs-decision", openDecisions: 0 });

      const [entry] = Array.from(
        yield* host
          .events(home.caller, { ...home.call, afterSequence: 0 })
          .pipe(Stream.take(1), Stream.runCollect),
      );
      assert.deepStrictEqual(entry?.event, {
        _tag: "reported",
        status: "needs-decision",
        summary: "Which browser first?",
        until: null,
        runId: RunId.make("run-7"),
        decisionKey: "browser",
        clearedDecision: null,
      });
      // This environment holds no Pivot for it: nothing in the Pivot store, no wake.
      assert.isNull(yield* store.getTeammate(ship.threadId));
      assert.deepStrictEqual(yield* store.listTeammates({ includeTornDown: true }), []);
      assert.deepStrictEqual(fake.wakes, []);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "checks `done` against the host's own git, and refuses `until` on any other status",
    () => {
      const { fake, workspaceRoot, layer } = hostSetup();
      return Effect.gen(function* () {
        const pivots = yield* PivotService.PivotService;
        const home = yield* newHome();
        const ship = yield* launch(home);
        const worktree = attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);

        NodeFS.writeFileSync(NodePath.join(worktree, "login.txt"), "fixed\n");
        const done = { status: "done", summary: "Fixed." } as const;
        const refused = yield* pivots.reportStatus(ship.threadId, done).pipe(Effect.flip);
        assert.include(refused.message, "needs all work committed");
        assert.include(refused.message, "login.txt");

        sh(worktree, "git add -A && git commit -q -m fix");
        assert.strictEqual((yield* pivots.reportStatus(ship.threadId, done)).status, "done");

        const until = yield* pivots
          .reportStatus(ship.threadId, {
            status: "working",
            summary: "Waiting.",
            until: "2026-10-14T00:00:00.000Z",
          })
          .pipe(Effect.flip);
        assert.strictEqual(until.message, "Only a `paused` report takes `until`.");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("records a scout's report in the log, and only a scout's", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const pivots = yield* PivotService.PivotService;
      const home = yield* newHome();
      const scout = yield* launch(home, { kind: "scout" });
      const ship = yield* launch(home, { dispatchId: "dispatch-2" });

      assert.deepStrictEqual(
        yield* pivots.recordScoutReport(scout.threadId, { report: "It is the cache." }),
        { recorded: true },
      );
      assert.strictEqual(
        (yield* pivots.recordScoutReport(ship.threadId, { report: "Nope." }).pipe(Effect.flip))
          .message,
        "Only a scout records a report.",
      );
      const [entry] = Array.from(
        yield* host
          .events(home.caller, { ...home.call, afterSequence: 0 })
          .pipe(Stream.take(1), Stream.runCollect),
      );
      assert.deepStrictEqual(entry?.event, {
        _tag: "scout-report-recorded",
        report: "It is the cache.",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses a torn-down hosted teammate and a thread nobody dispatched", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const pivots = yield* PivotService.PivotService;
      const home = yield* newHome();
      const ship = yield* launch(home);
      yield* host.teardown(home.caller, { ...home.call, threadId: ship.threadId, force: true });

      const report = { status: "working", summary: "Still here." } as const;
      assert.strictEqual(
        (yield* pivots.reportStatus(ship.threadId, report).pipe(Effect.flip)).message,
        "This teammate was torn down.",
      );
      assert.strictEqual(
        (yield* pivots.reportStatus(ThreadId.make("thread-nobody"), report).pipe(Effect.flip))
          .message,
        "Only a teammate can use this tool.",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "leaves a local teammate's reports in the Pivot store and out of the hosted log",
    () => {
      const { fake, layer } = hostSetup();
      return Effect.gen(function* () {
        const pivots = yield* PivotService.PivotService;
        const store = yield* PivotStore.PivotStore;
        const hostStore = yield* PivotHostStore.PivotHostStore;
        const home = yield* newHome();
        const { threadId: pivot } = yield* pivots.create({
          projectId,
          modelSelection,
          takeover: false,
        });
        const local = yield* pivots.dispatchTeammate(pivot, {
          title: "Local task",
          kind: "ship",
          intent: "Do the local thing.",
          spec: "Do it.",
        });
        yield* pivots.reportStatus(local.threadId, { status: "working", summary: "Going." });
        assert.strictEqual((yield* store.getTeammate(local.threadId))?.report?.status, "working");
        assert.isNull(yield* hostStore.getTeammate(local.threadId));
        assert.isNull(
          yield* hostStore.appendEvent({ threadId: local.threadId, event: { _tag: "activity" } }),
        );
        assert.deepStrictEqual(
          yield* hostStore.entriesAfter({ grantId: home.grantId, afterSequence: 0, limit: 10 }),
          [],
        );
        assert.isFalse(fake.threads.get(local.threadId)!.archived);
      }).pipe(Effect.provide(layer));
    },
  );
});

describe("hosted teammates and the supervisor", () => {
  const withSupervisor = (layer: ReturnType<typeof hostSetup>["layer"]) =>
    PivotSupervisor.layer.pipe(Layer.provideMerge(layer));

  const logged = (home: FakeHome) =>
    Effect.gen(function* () {
      const store = yield* PivotHostStore.PivotHostStore;
      const entries = yield* store.entriesAfter({
        grantId: home.grantId,
        afterSequence: 0,
        limit: 100,
      });
      return entries.map((entry) => entry.event);
    });

  it.effect("logs activity, a direct message and an answered request for a hosted teammate", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const home = yield* newHome();
      const ship = yield* launch(home);

      yield* supervisor.handleEvent({ type: "activity", threadId: ship.threadId });
      // A turn streams many events; only one a spell is logged.
      yield* supervisor.handleEvent({ type: "activity", threadId: ship.threadId });
      yield* TestClock.adjust(PivotSupervisor.HOSTED_ACTIVITY_LOG_SPACING_MS + 1);
      yield* supervisor.handleEvent({ type: "activity", threadId: ship.threadId });
      const message = {
        type: "user-message",
        threadId: ship.threadId,
        messageId: "message-1",
        text: "Use Safari 17.",
      } as const;
      yield* supervisor.handleEvent(message);
      yield* supervisor.handleEvent(message);
      yield* supervisor.handleEvent({
        type: "request-answered",
        threadId: ship.threadId,
        answer: "Yes, run it.",
      });

      assert.deepStrictEqual(yield* logged(home), [
        { _tag: "activity" },
        { _tag: "activity" },
        { _tag: "user-message", text: "Use Safari 17." },
        { _tag: "request-answered", answer: "Yes, run it." },
      ]);
    }).pipe(Effect.provide(withSupervisor(layer)));
  });

  it.effect("keeps local teammates and other threads out of the hosted log", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const pivots = yield* PivotService.PivotService;
      const home = yield* newHome();
      const { threadId: pivot } = yield* pivots.create({
        projectId,
        modelSelection,
        takeover: false,
      });
      const local = yield* pivots.dispatchTeammate(pivot, {
        title: "Local task",
        kind: "ship",
        intent: "Do the local thing.",
        spec: "Do it.",
      });
      yield* supervisor.tick;
      yield* supervisor.handleEvent({ type: "activity", threadId: local.threadId });
      yield* supervisor.handleEvent({
        type: "user-message",
        threadId: local.threadId,
        messageId: "message-local",
        text: "Hello local.",
      });
      yield* supervisor.handleEvent({ type: "activity", threadId: ThreadId.make("somebody") });

      assert.deepStrictEqual(yield* logged(home), []);
      // The local teammate still gets what it always did.
      const store = yield* PivotStore.PivotStore;
      const history = yield* store.teammateHistory({ threadId: local.threadId, limit: 20 });
      assert.isTrue(history.some((entry) => entry.event.type === "teammate.user-message"));
    }).pipe(Effect.provide(withSupervisor(layer)));
  });

  it.effect("logs nothing once the hosted teammate is torn down", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      yield* host.teardown(home.caller, { ...home.call, threadId: ship.threadId, force: true });
      yield* supervisor.handleEvent({ type: "activity", threadId: ship.threadId });
      assert.deepStrictEqual(yield* logged(home), []);
    }).pipe(Effect.provide(withSupervisor(layer)));
  });

  it.effect(
    "releases a hosted teammate's held queue when the supervisor starts, as for a local one",
    () => {
      const { fake, layer } = hostSetup();
      return Effect.gen(function* () {
        const supervisor = yield* PivotSupervisor.PivotSupervisor;
        const home = yield* newHome();
        const ship = yield* launch(home);
        yield* supervisor.tick;
        assert.include(fake.releasedQueues, ship.threadId);
      }).pipe(Effect.provide(withSupervisor(layer)));
    },
  );
});

describe("hosted teammates and restart carry-on", () => {
  it.effect("carries on a live hosted teammate, and no one else's thread", () => {
    const { layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const carryOn = yield* RestartCarryOn;
      const home = yield* newHome();
      const ship = yield* launch(home);
      assert.isTrue(yield* carryOn.carriesOn(ship.threadId));
      assert.isFalse(yield* carryOn.carriesOn(ThreadId.make("an-ordinary-thread")));

      // Resuming a hosted teammate has no Pivot record to mark: it writes nothing to the Pivot
      // store (no record, no events) and leaves the teammate carried on.
      const pivotStore = yield* PivotStore.PivotStore;
      yield* carryOn.resuming(ship.threadId);
      assert.isNull(yield* pivotStore.getTeammate(ship.threadId));
      assert.deepStrictEqual(yield* pivotStore.listTeammates({ includeTornDown: true }), []);
      assert.isTrue(yield* carryOn.carriesOn(ship.threadId));

      yield* host.teardown(home.caller, { ...home.call, threadId: ship.threadId, force: true });
      assert.isFalse(yield* carryOn.carriesOn(ship.threadId));
    }).pipe(Effect.provide(PivotCarryOn.layer.pipe(Layer.provideMerge(layer))));
  });
});

describe("PivotHost grants", () => {
  it.effect("creates, edits, lists and revokes links without exposing a credential", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const grant = yield* host.createGrant({ allowedProjectIds: [projectId, projectId] });
      assert.strictEqual(grant.subject, `pivot-host:${grant.grantId}`);
      assert.deepStrictEqual(grant.allowedProjectIds, [projectId]);
      assert.isNull(grant.boundHomeEnvironmentId);

      const edited = yield* host.setGrantAllowlist(grant.grantId, [docsProjectId]);
      assert.deepStrictEqual(edited.allowedProjectIds, [docsProjectId]);
      assert.deepStrictEqual(
        (yield* host.listGrants).map((listed) => Object.keys(listed).toSorted()),
        [
          [
            "allowedProjectIds",
            "boundHomeEnvironmentId",
            "createdAt",
            "grantId",
            "revokedAt",
            "subject",
          ],
        ],
      );

      assert.strictEqual(
        (yield* flipped(host.setGrantAllowlist(grant.grantId, [ProjectId.make("project-gone")])))
          .message,
        "Project project-gone was not found.",
      );
      yield* host.revokeGrant(grant.grantId);
      yield* host.revokeGrant(grant.grantId);
      assert.strictEqual(
        (yield* flipped(host.setGrantAllowlist(grant.grantId, [projectId]))).message,
        `Host link ${grant.grantId} does not exist or was revoked.`,
      );
      assert.strictEqual(
        (yield* flipped(host.revokeGrant("grant-never-made"))).message,
        "Host link grant-never-made does not exist.",
      );
    }).pipe(Effect.provide(layer));
  });
});

/** Holds a launch where the test needs it: the first launch at its first-run wait, inside the lock. */
const gatedLaunches = () => {
  const gate = Deferred.makeUnsafe<void>();
  const firstWaiting = Deferred.makeUnsafe<void>();
  const secondQueued = Deferred.makeUnsafe<void>();
  let awaits = 0;
  let locks = 0;
  const wrap = Layer.effect(
    TeammateHost,
    Effect.gen(function* () {
      const real = yield* TeammateHost;
      return TeammateHost.of({
        ...real,
        // The second launch has passed its first authorization and is about to queue.
        withProjectLock: (projectId, effect) =>
          (++locks === 2 ? Deferred.succeed(secondQueued, undefined) : Effect.void).pipe(
            Effect.andThen(real.withProjectLock(projectId, effect)),
          ),
        awaitStart: (threadId, runId) =>
          ++awaits === 1
            ? Deferred.succeed(firstWaiting, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(real.awaitStart(threadId, runId)),
              )
            : real.awaitStart(threadId, runId),
      });
    }),
  );
  return { gate, firstWaiting, secondQueued, wrap };
};

describe("a launch that waits its turn", () => {
  /** A launch is running, a second is queued behind it, `change` happens, then the first finishes. */
  const queuedBehind = (
    change: (home: FakeHome) => Effect.Effect<void, PivotHostServiceError, PivotHost.PivotHost>,
  ) => {
    const held = gatedLaunches();
    const { fake, layer } = hostSetupWrapped(held.wrap);
    addDocsProject(fake);
    return {
      fake,
      layer,
      run: Effect.gen(function* () {
        const home = yield* newHome([projectId, docsProjectId]);
        const first = yield* launch(home, { dispatchId: "first" }).pipe(Effect.forkChild);
        yield* Deferred.await(held.firstWaiting);
        const second = yield* launch(home, { dispatchId: "second", title: "Second" }).pipe(
          Effect.forkChild,
        );
        yield* Deferred.await(held.secondQueued);
        yield* change(home);
        yield* Deferred.succeed(held.gate, undefined);
        yield* Fiber.join(first);
        return { home, refusal: yield* flipped(Fiber.join(second)) };
      }),
    };
  };

  it.effect("is refused when its link was revoked while it waited, and launches nothing", () => {
    const { fake, layer, run } = queuedBehind((home) =>
      Effect.flatMap(PivotHost.PivotHost, (host) => host.revokeGrant(home.grantId)),
    );
    return Effect.gen(function* () {
      const { refusal } = yield* run;
      assert.strictEqual(refusal.code, "revoked");
      assert.lengthOf(teammates(fake), 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("is refused when its project left the allowlist while it waited", () => {
    const { fake, layer, run } = queuedBehind((home) =>
      Effect.flatMap(PivotHost.PivotHost, (host) =>
        host.setGrantAllowlist(home.grantId, [docsProjectId]).pipe(Effect.asVoid),
      ),
    );
    return Effect.gen(function* () {
      const { refusal } = yield* run;
      assert.strictEqual(refusal.code, "project-not-allowed");
      assert.lengthOf(teammates(fake), 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "leaves no record, and archives its thread, when the link is revoked as it records",
    () => {
      // The link is revoked after the launch passed its checks and before it was recorded.
      const hook = { revoke: (): Effect.Effect<void, PivotHostServiceError> => Effect.void };
      const wrap = Layer.effect(
        TeammateHost,
        Effect.gen(function* () {
          const real = yield* TeammateHost;
          return TeammateHost.of({
            ...real,
            launch: (input) =>
              real.launch(input).pipe(Effect.tap(() => Effect.orDie(hook.revoke()))),
          });
        }),
      );
      const { fake, layer } = hostSetupWrapped(wrap);
      return Effect.gen(function* () {
        const host = yield* PivotHost.PivotHost;
        const hostStore = yield* PivotHostStore.PivotHostStore;
        const home = yield* newHome();
        hook.revoke = () => host.revokeGrant(home.grantId);
        assert.strictEqual((yield* flipped(launch(home))).code, "revoked");
        assert.isNull(yield* hostStore.findByDispatch(home.grantId, "dispatch-1"));
        assert.deepStrictEqual(teammates(fake).map(discarded), [[true, 1, 1]]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("stops a teammate whose link was revoked while its relaunch ran", () => {
    // The link is revoked after the relaunch passed its checks and started a run.
    const hook = { revoke: (): Effect.Effect<void, PivotHostServiceError> => Effect.void };
    const wrap = Layer.effect(
      TeammateHost,
      Effect.gen(function* () {
        const real = yield* TeammateHost;
        return TeammateHost.of({
          ...real,
          relaunch: (input) =>
            real.relaunch(input).pipe(Effect.tap(() => Effect.orDie(hook.revoke()))),
        });
      }),
    );
    const { fake, layer } = hostSetupWrapped(wrap);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const home = yield* newHome();
      const ship = yield* launch(home);
      const thread = fake.threads.get(ship.threadId)!;
      hook.revoke = () => host.revokeGrant(home.grantId);
      const refusal = yield* flipped(
        host.relaunch(home.caller, { ...home.call, threadId: ship.threadId, text: "Again." }),
      );
      assert.strictEqual(refusal.code, "revoked");
      // Revoke stopped it once; the relaunch's own re-check stopped the run it started.
      assert.strictEqual(thread.stops, 2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("launches once when one dispatchId is sent for two projects at the same time", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const home = yield* newHome([projectId, docsProjectId]);
      const outcomes = yield* Effect.all(
        [projectId, docsProjectId].map((id) =>
          launch(home, { projectId: id, dispatchId: "same" }).pipe(
            Effect.map(() => "launched" as const),
            Effect.catchTags({
              PivotRefusedError: (error) => Effect.succeed(error.message),
              PivotHostRefusedError: (error) => Effect.succeed(error.message),
            }),
          ),
        ),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(outcomes.toSorted(), [
        "That dispatchId was used for a different launch.",
        "launched",
      ]);
      assert.lengthOf(teammates(fake), 1);
      assert.isFalse(teammates(fake)[0]!.archived);
    }).pipe(Effect.provide(layer));
  });
});

describe("what a launch is limited to", () => {
  it.effect("refuses a base branch that is not a plausible ref name, without launching", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const home = yield* newHome();
      for (const baseBranch of [
        "--upload-pack=evil",
        "-rf",
        "a..b",
        "a b",
        "main.lock",
        "x/",
        "",
      ]) {
        assert.strictEqual(
          (yield* flipped(launch(home, { baseBranch }))).message,
          "The base branch is not a valid branch name.",
          baseBranch,
        );
      }
      assert.lengthOf(teammates(fake), 0);
      yield* launch(home, { baseBranch: "release/1.2-rc.1" });
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "runs a link's teammates up to a cap, names the cap, and frees a place on teardown",
    () => {
      const { fake, layer } = hostSetup();
      return Effect.gen(function* () {
        const host = yield* PivotHost.PivotHost;
        const home = yield* newHome();
        const launched = [];
        for (let index = 0; index < PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES; index++) {
          launched.push(yield* launch(home, { dispatchId: `dispatch-${index}` }));
        }
        assert.strictEqual(
          (yield* flipped(launch(home, { dispatchId: "one-too-many" }))).message,
          `This host link already runs ${PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES} teammates, the most it may. Tear one down first.`,
        );
        assert.lengthOf(teammates(fake), PivotHost.PIVOT_HOST_MAX_LIVE_TEAMMATES);
        // A retry of a launch already made is not a new teammate.
        assert.strictEqual(
          (yield* launch(home, { dispatchId: "dispatch-3" })).threadId,
          launched[3]!.threadId,
        );

        yield* host.teardown(home.caller, {
          ...home.call,
          threadId: launched[0]!.threadId,
          force: true,
        });
        yield* launch(home, { dispatchId: "one-too-many" });
      }).pipe(Effect.provide(layer));
    },
  );
});

describe("a teammate whose project leaves the allowlist", () => {
  it.effect("is stopped and no longer live, and its siblings in kept projects run on", () => {
    const { fake, layer } = hostSetup();
    addDocsProject(fake);
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome([projectId, docsProjectId]);
      const app = yield* launch(home, { dispatchId: "app" });
      const docs = yield* launch(home, { dispatchId: "docs", projectId: docsProjectId });

      yield* host.setGrantAllowlist(home.grantId, [projectId]);
      assert.strictEqual(fake.threads.get(docs.threadId)!.stops, 1);
      assert.strictEqual(fake.threads.get(app.threadId)!.stops, 0);
      assert.isFalse(yield* store.isLive(docs.threadId));
      assert.isTrue(yield* store.isLive(app.threadId));

      yield* host.setGrantAllowlist(home.grantId, [projectId, docsProjectId]);
      assert.isTrue(yield* store.isLive(docs.threadId));
    }).pipe(Effect.provide(layer));
  });
});

describe("a revoked link's teammates", () => {
  it.effect("are stopped but keep their worktrees, and are no longer live", () => {
    const { fake, workspaceRoot, layer } = hostSetup();
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const store = yield* PivotHostStore.PivotHostStore;
      const pivots = yield* PivotService.PivotService;
      const mine = yield* newHome();
      const theirs = yield* newHome([projectId], otherHomeEnvironmentId);
      const a = yield* launch(mine, { dispatchId: "a" });
      const b = yield* launch(mine, { dispatchId: "b" });
      const other = yield* launch(theirs);
      attachWorktree(fake, workspaceRoot, a.threadId, a.branch);

      yield* host.revokeGrant(mine.grantId);
      assert.deepStrictEqual(
        [a, b, other].map((teammate) => fake.threads.get(teammate.threadId)!.stops),
        [1, 1, 0],
      );
      assert.deepStrictEqual(fake.removedWorktrees, []);
      assert.isFalse(fake.threads.get(a.threadId)!.archived);
      assert.isFalse(yield* store.isLive(a.threadId));
      assert.isFalse(yield* store.isLive(b.threadId));
      assert.isTrue(yield* store.isLive(other.threadId));
      assert.strictEqual(
        (yield* pivots
          .reportStatus(a.threadId, { status: "working", summary: "Still going." })
          .pipe(Effect.flip)).message,
        "This teammate's host link was revoked, or no longer allows its project.",
      );
      // A repeat revoke stops them again, which is harmless, and is what retries a stop that failed.
      yield* host.revokeGrant(mine.grantId);
      assert.strictEqual(fake.threads.get(a.threadId)!.stops, 2);
      assert.strictEqual(fake.threads.get(other.threadId)!.stops, 0);
      // Their dev servers stop with them.
      assert.strictEqual(fake.stoppedCheckouts.length, 4);
    }).pipe(Effect.provide(layer));
  });

  it.effect("are neither carried on after a restart nor logged by the supervisor", () => {
    const { fake, layer } = hostSetup();
    const supervised = PivotSupervisor.layer.pipe(
      Layer.provideMerge(PivotCarryOn.layer.pipe(Layer.provideMerge(layer))),
    );
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const carryOn = yield* RestartCarryOn;
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const hostStore = yield* PivotHostStore.PivotHostStore;
      const home = yield* newHome();
      const ship = yield* launch(home);
      assert.isTrue(yield* carryOn.carriesOn(ship.threadId));

      yield* host.revokeGrant(home.grantId);
      assert.isFalse(yield* carryOn.carriesOn(ship.threadId));
      yield* supervisor.tick;
      assert.notInclude(fake.releasedQueues, ship.threadId);
      yield* supervisor.handleEvent({ type: "activity", threadId: ship.threadId });
      assert.deepStrictEqual(
        yield* hostStore.entriesAfter({ grantId: home.grantId, afterSequence: 0, limit: 10 }),
        [],
      );
    }).pipe(Effect.provide(supervised));
  });
});

describe("pull requests of a hosted teammate", () => {
  const withLinkedPullRequest = (
    link: { readonly host?: string; readonly repository: string; readonly number: number },
    identity: RepositoryIdentity | null,
  ) => {
    const { fake, layer } = hostSetup({ remote: true });
    return {
      fake,
      layer,
      prepare: Effect.gen(function* () {
        const home = yield* newHome();
        const ship = yield* launch(home);
        fake.projects.set(projectId, {
          ...fake.projects.get(projectId)!,
          repositoryIdentity: identity,
        });
        const url = `https://${link.host ?? "github.com"}/${link.repository}/pull/${link.number}`;
        fake.threads.get(ship.threadId)!.shell = {
          pullRequests: [{ url, ...link }],
        } as never;
        fake.pullRequests.set(url, { headSha: "abc123", state: "open" });
        return {
          home,
          ship,
          input: { ...home.call, threadId: ship.threadId, ...link },
        };
      }),
    };
  };

  it.effect(
    "must be in the repository of the allowlisted project, whatever the thread links",
    () => {
      // The teammate's thread links a PR of another repository, or the host cannot tell.
      const cases = [
        { link: { repository: "evil/app", number: 7 }, identity: acmeApp },
        { link: { host: "gitlab.com", repository: "acme/app", number: 7 }, identity: acmeApp },
        { link: { repository: "acme/app", number: 7 }, identity: null },
        { link: { repository: "me/acme/app", number: 7 }, identity: acmeApp },
      ];
      return Effect.forEach(cases, ({ link, identity }) => {
        const { fake, layer, prepare } = withLinkedPullRequest(link, identity);
        return Effect.gen(function* () {
          const host = yield* PivotHost.PivotHost;
          const { home, input } = yield* prepare;
          for (const run of [
            host.pullRequestDetail(home.caller, input),
            host.mergePullRequest(home.caller, { ...input, expectedHeadSha: "abc123" }),
          ]) {
            assert.strictEqual(
              (yield* flipped(run)).message,
              "That pull request is not linked to this teammate.",
              JSON.stringify(link),
            );
          }
          assert.deepStrictEqual(fake.merges, []);
        }).pipe(Effect.provide(layer));
      });
    },
  );

  it.effect("match a fork's own repository too, and read after the teammate is torn down", () => {
    const fork = { ...acmeApp, origin: { canonicalKey: "github.com/me/app-fork" } };
    const { layer, prepare } = withLinkedPullRequest(
      { repository: "me/app-fork", number: 7 },
      fork,
    );
    return Effect.gen(function* () {
      const host = yield* PivotHost.PivotHost;
      const { home, ship, input } = yield* prepare;
      assert.strictEqual((yield* host.pullRequestDetail(home.caller, input)).headSha, "abc123");

      // Reading a torn-down teammate's PR stays allowed: it changes nothing. Merging does not.
      yield* host.teardown(home.caller, { ...home.call, threadId: ship.threadId, force: true });
      assert.strictEqual((yield* host.pullRequestDetail(home.caller, input)).headSha, "abc123");
      assert.strictEqual(
        (yield* flipped(
          host.mergePullRequest(home.caller, { ...input, expectedHeadSha: "abc123" }),
        )).message,
        `Teammate ${ship.threadId} was torn down.`,
      );
    }).pipe(Effect.provide(layer));
  });
});

describe("hosted `done` when the project delivers pull requests", () => {
  it.effect("needs a linked PR on the right branch, and the branch pushed", () => {
    const { fake, workspaceRoot, layer } = hostSetup({ remote: true });
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const home = yield* newHome();
      const ship = yield* launch(home);
      assert.strictEqual(ship.deliveryMode, "direct-pr");
      const worktree = attachWorktree(fake, workspaceRoot, ship.threadId, ship.branch);
      const done = { status: "done", summary: "Fixed." } as const;
      const refusal = () => pivots.reportStatus(ship.threadId, done).pipe(Effect.flip);

      assert.include((yield* refusal()).message, "`done` needs a linked PR.");

      const url = "https://github.com/acme/app/pull/7";
      const thread = fake.threads.get(ship.threadId)!;
      thread.shell = {
        pullRequests: [{ url, snapshot: { headBranch: "pivot/somebody-else" } }],
      } as never;
      assert.include((yield* refusal()).message, "not your branch");

      thread.shell = { pullRequests: [{ url, snapshot: { headBranch: ship.branch } }] } as never;
      assert.include((yield* refusal()).message, "is not pushed");

      sh(worktree, `git push -q origin ${ship.branch}`);
      assert.strictEqual((yield* pivots.reportStatus(ship.threadId, done)).status, "done");
    }).pipe(Effect.provide(layer));
  });
});

describe("what a failure tells the home", () => {
  it("keeps a refusal's message and reason, and says only that anything else failed", () => {
    const refused = PivotHost.pivotHostWireError(
      new PivotHostRefusedError({ code: "project-not-allowed", reason: "Nope." }),
    );
    assert.deepStrictEqual([refused.reason, refused.message], ["project-not-allowed", "Nope."]);
    const declined = PivotHost.pivotHostWireError(
      new PivotStore.PivotRefusedError({ command: "x", reason: "Project p was not found." }),
    );
    assert.deepStrictEqual(
      [declined.reason, declined.message],
      ["refused", "Project p was not found."],
    );

    const internal = [
      new PivotStore.PivotStoreError({
        operation: "host recordTeammate",
        cause: new Error("SQLITE_ERROR at /home/matteo/.t3/pivot.sqlite: no such table"),
      }),
      new PivotThreads.PivotThreadsError({
        operation: "launch the teammate",
        threadId: "thread-1",
        cause: new Error("ENOENT /home/matteo/secret"),
      }),
    ];
    for (const cause of internal) {
      const wire = PivotHost.pivotHostWireError(cause);
      assert.deepStrictEqual(
        [wire.reason, wire.message, "cause" in wire && wire.cause !== undefined],
        ["failed", "The host could not complete that request.", false],
      );
    }
  });

  it("redacts paths and bounds what a failed run or setup script reports", () => {
    assert.isNull(PivotHost.redactDetail(null));
    assert.strictEqual(
      PivotHost.redactDetail("Setup failed in /home/matteo/.t3/worktrees/app/pivot-x: exit 1"),
      "Setup failed in <path>: exit 1",
    );
    assert.strictEqual(
      PivotHost.redactDetail("cannot open C:\\Users\\me\\repo\\file.txt"),
      "cannot open <path>",
    );
    assert.strictEqual(PivotHost.redactDetail("and/or the retry"), "and/or the retry");
    const long = PivotHost.redactDetail("x".repeat(5000))!;
    assert.isAtMost(long.length, 300);
  });

  it.effect("reaches the home without paths when a launch's run or setup fails", () => {
    const { fake, layer } = hostSetup();
    return Effect.gen(function* () {
      const home = yield* newHome();
      fake.nextLaunch = {
        worktreePath: null,
        start: { type: "failed", runId: RunId.make("run-x"), detail: "No such file /srv/repo/x" },
      };
      const launched = yield* launch(home);
      assert.strictEqual(launched.firstRun, "failed");
      assert.strictEqual(launched.detail, "No such file <path>");
    }).pipe(Effect.provide(layer));
  });

  it("makes the caller from the session's subject and scopes, whatever else it carries", () => {
    const session = {
      subject: "pivot-host:grant-1",
      scopes: ["pivot:host" as const],
      homeEnvironmentId: "environment-liar",
      sessionId: "session-1",
    };
    assert.deepStrictEqual(callerOfSession(session), {
      subject: "pivot-host:grant-1",
      scopes: ["pivot:host"],
    });
  });

  it("matches a PR's repository to the project's, and to nothing else", () => {
    const { repositoryMatchesProject: matches } = PivotHost;
    assert.isTrue(matches(acmeApp, { repository: "acme/app" }));
    assert.isTrue(matches(acmeApp, { host: "GitHub.com", repository: "Acme/App" }));
    assert.isFalse(matches(acmeApp, { host: "gitlab.com", repository: "acme/app" }));
    assert.isFalse(matches(acmeApp, { repository: "evil-acme/app" }));
    assert.isFalse(matches(acmeApp, { repository: "app" }));
    assert.isFalse(matches(null, { repository: "acme/app" }));
  });
});

describe("hosted teammates after a host restart", () => {
  it.effect("are rebuilt from pivot.sqlite: live ones carry on, a revoked link's do not", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeFS.realpathSync("/tmp"), "t3-pivot-host-"));
    // Each provide below is one start of the host over the same file.
    const started = PivotCarryOn.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(PivotStore.layer, PivotHostStore.layer).pipe(
          Layer.provide(PivotDatabase.layer),
          Layer.provide(ServerConfig.layerTest(process.cwd(), dir)),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
    const record = (grantId: string, threadId: string) => ({
      threadId: ThreadId.make(threadId),
      grantId,
      dispatchId: threadId,
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
    });
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const store = yield* PivotHostStore.PivotHostStore;
        const kept = yield* store.createGrant({ allowedProjectIds: [projectId] });
        const revoked = yield* store.createGrant({ allowedProjectIds: [projectId] });
        yield* store.recordTeammate(record(kept.grantId, "thread-live"));
        yield* store.recordTeammate(record(kept.grantId, "thread-torn-down"));
        yield* store.recordTeammate(record(revoked.grantId, "thread-revoked"));
        yield* store.markTornDown(ThreadId.make("thread-torn-down"));
        yield* store.revokeGrant(revoked.grantId);
      }).pipe(Effect.provide(started));

      yield* Effect.gen(function* () {
        const store = yield* PivotHostStore.PivotHostStore;
        const carryOn = yield* RestartCarryOn;
        const carried = yield* Effect.forEach(
          ["thread-live", "thread-torn-down", "thread-revoked", "thread-unknown"],
          (id) => carryOn.carriesOn(ThreadId.make(id)),
        );
        assert.deepStrictEqual(carried, [true, false, false, false]);
        assert.deepStrictEqual(Array.from(yield* store.liveThreadIds, String), ["thread-live"]);
      }).pipe(Effect.provide(started));
    }).pipe(
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true }))),
    );
  });
});
