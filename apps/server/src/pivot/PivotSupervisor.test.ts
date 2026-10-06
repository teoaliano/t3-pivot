import { assert, describe, it } from "@effect/vitest";
import { RunId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { RestartCarryOn } from "../orchestration-v2/RestartCarryOn.ts";
import { ThreadToolRestrictions } from "../orchestration-v2/ThreadToolRestrictions.ts";
import * as PivotCarryOn from "./PivotCarryOn.ts";
import * as PivotToolRestrictions from "./PivotToolRestrictions.ts";
import * as PivotService from "./PivotService.ts";
import { harness, modelSelection, projectId, setup } from "./PivotService.testkit.ts";
import * as PivotStore from "./PivotStore.ts";
import * as PivotSupervisor from "./PivotSupervisor.ts";
import type { FakeV2 } from "./PivotThreads.testkit.ts";

const withSupervisor = (fake: FakeV2) =>
  PivotSupervisor.layer.pipe(Layer.provideMerge(harness(fake)));

const tick = Effect.flatMap(PivotSupervisor.PivotSupervisor, (supervisor) => supervisor.tick);

/** Changes a thread's V2 shell, with the event V2 would emit for it. */
const shell = (fake: FakeV2, threadId: ThreadId, patch: Record<string, unknown>) =>
  Effect.gen(function* () {
    const thread = fake.threads.get(threadId)!;
    thread.shell = { ...thread.shell, ...patch };
    const supervisor = yield* PivotSupervisor.PivotSupervisor;
    yield* supervisor.handleEvent({ type: "activity", threadId });
  });

/** A Pivot with one running teammate, and the supervisor caught up on both. */
const running = (fake: FakeV2, title = "Fix the login bug") =>
  Effect.gen(function* () {
    const pivots = yield* PivotService.PivotService;
    const existing = yield* Effect.flatMap(PivotStore.PivotStore, (store) =>
      store.getActivePivot(projectId),
    );
    const pivot =
      existing?.threadId ??
      (yield* pivots.create({ projectId, modelSelection, takeover: false })).threadId;
    const teammate = (yield* pivots.dispatchTeammate(pivot, {
      title,
      kind: "ship",
      intent: "Make the login button work on Safari.",
      spec: "Reproduce, fix, test.",
    })).threadId;
    yield* shell(fake, teammate, { status: "running", activeRunId: RunId.make(`run-${teammate}`) });
    yield* tick;
    return { pivot, teammate };
  });

/** Ends the teammate's run, having reported `status` in it. */
const finish = (
  fake: FakeV2,
  teammate: ThreadId,
  status: "done" | "needs-decision" | "blocked" | "failed" | "paused",
  until?: string,
) =>
  Effect.gen(function* () {
    const pivots = yield* PivotService.PivotService;
    yield* pivots.reportStatus(teammate, {
      status,
      summary: `${status} summary`,
      ...(until === undefined ? {} : { until }),
    });
    yield* shell(fake, teammate, { status: "idle", activeRunId: null });
  });

const wakesFor = (fake: FakeV2, pivot: ThreadId) =>
  fake.wakes.filter((wake) => wake.pivotThreadId === pivot);

describe("PivotSupervisor", () => {
  it.effect("wakes the Pivot when a teammate is done, once", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      assert.deepStrictEqual(wakesFor(fake, pivot), []);

      yield* finish(fake, teammate, "done");
      yield* tick;
      const [wake] = wakesFor(fake, pivot);
      assert.strictEqual(wake?.summary, "1 teammate changed");
      assert.deepStrictEqual(wake?.teammateThreadIds, [teammate]);
      assert.include(
        wake!.text,
        `"Fix the login bug" (ship, thread ${teammate}): done — done summary`,
      );

      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("wakes on every status in the wake set, and never on working", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      const pivots = yield* PivotService.PivotService;
      yield* pivots.reportStatus(teammate, { status: "working", summary: "Reproduced" });
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);

      for (const status of ["needs-decision", "blocked", "failed"] as const) {
        yield* shell(fake, teammate, {
          status: "running",
          latestRunId: RunId.make(`run-${status}`),
        });
        yield* tick;
        yield* finish(fake, teammate, status);
        yield* tick;
      }
      // Stopped without a report, and held on an approval.
      yield* shell(fake, teammate, { status: "running", latestRunId: RunId.make("run-silent") });
      yield* tick;
      yield* shell(fake, teammate, { status: "idle" });
      yield* tick;
      yield* shell(fake, teammate, {
        status: "running",
        latestRunId: RunId.make("run-held"),
        pendingRuntimeRequest: { kind: "approval" },
      });
      yield* tick;

      const statuses = wakesFor(fake, pivot).map((wake) => wake.text.split("\n")[1]);
      assert.deepStrictEqual(
        statuses.map((line) => line?.match(/\): ([a-z-]+)/)?.[1]),
        ["needs-decision", "blocked", "failed", "unreported", "waiting"],
      );
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect(
    "attaches the stuck ladder to an unreported teammate and the diagnosis to a failed one",
    () => {
      const { fake } = setup();
      return Effect.gen(function* () {
        const { pivot, teammate } = yield* running(fake);
        yield* shell(fake, teammate, { status: "idle" });
        yield* tick;
        assert.include(
          wakesFor(fake, pivot)[0]!.text,
          "A teammate went quiet or stopped without a report",
        );

        yield* shell(fake, teammate, { status: "running", latestRunId: RunId.make("run-2") });
        yield* tick;
        yield* shell(fake, teammate, { status: "failed", lastError: "Provider crashed." });
        yield* tick;
        const failed = wakesFor(fake, pivot)[1]!.text;
        assert.include(failed, "failed — Provider crashed.");
        assert.notInclude(failed, "went quiet");
        assert.match(failed, /diagnos/i);
      }).pipe(Effect.provide(withSupervisor(fake)));
    },
  );

  it.effect("rechecks a paused teammate at its until, then every four hours", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      yield* finish(fake, teammate, "paused", "1970-01-01T01:00:00.000Z");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);

      yield* TestClock.adjust("59 minutes");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);
      yield* TestClock.adjust("1 minute");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
      assert.include(wakesFor(fake, pivot)[0]!.text, "Its wait was due for a recheck.");

      yield* TestClock.adjust("3 hours");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
      yield* TestClock.adjust("1 hour");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 2);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("rechecks a paused teammate with no until after four hours", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      yield* finish(fake, teammate, "paused");
      yield* tick;
      yield* TestClock.adjust("3 hours");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);
      yield* TestClock.adjust("1 hour");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("wakes once per run for a teammate quiet for 30 minutes, with the stuck ladder", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const { pivot, teammate } = yield* running(fake);
      yield* TestClock.adjust("29 minutes");
      yield* supervisor.handleEvent({ type: "activity", threadId: teammate });
      yield* TestClock.adjust("29 minutes");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);

      yield* TestClock.adjust("1 minute");
      yield* tick;
      const [wake] = wakesFor(fake, pivot);
      assert.include(wake!.text, "No activity for 30 minutes while running.");
      assert.include(wake!.text, "A teammate went quiet or stopped without a report");
      // Running, never interrupted.
      assert.strictEqual(fake.threads.get(teammate)?.stops, 0);

      yield* TestClock.adjust("2 hours");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);

      // A new run's events reset the clock; it can be stuck again 30 minutes later.
      yield* shell(fake, teammate, { activeRunId: RunId.make("run-next") });
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
      yield* TestClock.adjust("30 minutes");
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 2);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("changes landing while a wake is still queued join it", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const first = yield* running(fake, "First task");
      const second = yield* running(fake, "Second task");
      yield* finish(fake, first.teammate, "done");
      yield* tick;
      assert.strictEqual(wakesFor(fake, first.pivot).length, 1);

      fake.queuedWakes.add(first.pivot);
      yield* finish(fake, second.teammate, "blocked");
      yield* tick;
      const wakes = wakesFor(fake, first.pivot);
      assert.strictEqual(wakes.length, 1);
      assert.deepStrictEqual(wakes[0]!.teammateThreadIds, [first.teammate, second.teammate]);
      assert.include(wakes[0]!.text, '"First task"');
      assert.include(wakes[0]!.text, '"Second task"');

      // Delivered: the next wake starts after it.
      fake.queuedWakes.delete(first.pivot);
      yield* shell(fake, first.teammate, {
        status: "running",
        latestRunId: RunId.make("run-again"),
      });
      yield* tick;
      yield* finish(fake, first.teammate, "done");
      yield* tick;
      assert.deepStrictEqual(wakesFor(fake, first.pivot)[1]!.teammateThreadIds, [first.teammate]);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("never wakes the Pivot for what it caused itself", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      const pivots = yield* PivotService.PivotService;
      yield* shell(fake, teammate, { latestRunId: RunId.make("run-stopped") });
      yield* pivots.stopTeammate(pivot, { threadId: teammate });
      yield* shell(fake, teammate, { status: "interrupted", activeRunId: null });
      yield* tick;
      yield* pivots.openDecision(pivot, { teammateThreadId: teammate, question: "Split the PR?" });
      yield* tick;
      assert.deepStrictEqual(wakesFor(fake, pivot), []);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("wakes on the user's answer to an escalated decision, with their words", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      const pivots = yield* PivotService.PivotService;
      const { decision } = yield* pivots.openDecision(pivot, {
        teammateThreadId: teammate,
        question: "Drop the legacy endpoint?",
      });
      yield* pivots.escalateDecision(pivot, {
        decisionId: decision.decisionId,
        questions: ["Drop the legacy endpoint?"],
        evidence: "Unused for 90 days.",
        consequence: "Old clients break.",
        options: ["Drop", "Keep"],
        recommendation: "Drop",
      });
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 0);

      yield* pivots.recordUserAnswer({
        decisionId: decision.decisionId,
        answer: "Keep it one more release.",
      });
      yield* tick;
      const [wake] = wakesFor(fake, pivot);
      assert.include(wake!.text, 'The user answered "Keep it one more release."');
      assert.include(wake!.text, '"Fix the login bug"');
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("wakes on the user typing into a teammate, with the text verbatim", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const { pivot, teammate } = yield* running(fake);
      const event = {
        type: "user-message" as const,
        threadId: teammate,
        messageId: "message-1",
        text: "Use the new auth library instead.",
      };
      yield* supervisor.handleEvent(event);
      yield* supervisor.handleEvent(event);
      yield* tick;
      const wakes = wakesFor(fake, pivot);
      assert.strictEqual(wakes.length, 1);
      assert.include(
        wakes[0]!.text,
        'The user wrote to it directly: "Use the new auth library instead."',
      );
      // Messages in threads that are not teammates are not the Pivot's business.
      yield* supervisor.handleEvent({ ...event, threadId: pivot, messageId: "message-2" });
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, 1);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect(
    "wakes on a PR merged or closed outside the Pivot, and on checks gone red after done",
    () => {
      const { fake } = setup();
      return Effect.gen(function* () {
        const supervisor = yield* PivotSupervisor.PivotSupervisor;
        const { pivot, teammate } = yield* running(fake);
        const link = (state: string, checksState: string | null) => ({
          host: "github.com",
          repository: "o/r",
          number: 7,
          url: "https://github.com/o/r/pull/7",
          source: "agent" as const,
          linkedAt: "2026-10-06T00:00:00.000Z",
          snapshot: {
            state,
            title: "Fix",
            headBranch: "pivot/fix-the-login-bug",
            baseBranch: "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-10-06T00:00:00.000Z",
            checksState,
          },
          stack: null,
        });
        const sync = (state: string, checksState: string | null) =>
          supervisor.handleEvent({
            type: "pull-requests",
            threadId: teammate,
            links: [link(state, checksState) as never],
          });

        yield* sync("open", "passing");
        yield* finish(fake, teammate, "done");
        yield* tick;
        assert.strictEqual(wakesFor(fake, pivot).length, 1);

        yield* sync("open", "failing");
        yield* tick;
        assert.include(
          wakesFor(fake, pivot)[1]!.text,
          "Checks went red on its PR after it reported done: https://github.com/o/r/pull/7",
        );

        yield* sync("merged", "failing");
        yield* tick;
        assert.include(
          wakesFor(fake, pivot)[2]!.text,
          "Its PR merged outside T3: https://github.com/o/r/pull/7",
        );
      }).pipe(Effect.provide(withSupervisor(fake)));
    },
  );

  it.effect("a PR the Pivot merged itself is not news", () => {
    const { fake } = setup({ remote: true });
    return Effect.gen(function* () {
      const supervisor = yield* PivotSupervisor.PivotSupervisor;
      const pivots = yield* PivotService.PivotService;
      const { pivot, teammate } = yield* running(fake);
      const link = (state: string) =>
        ({
          host: "github.com",
          repository: "o/r",
          number: 7,
          url: "https://github.com/o/r/pull/7",
          source: "agent",
          linkedAt: "2026-10-06T00:00:00.000Z",
          snapshot: {
            state,
            title: "Fix",
            headBranch: "pivot/fix-the-login-bug",
            baseBranch: "main",
            isDraft: false,
            updatedAt: null,
            syncedAt: "2026-10-06T00:00:00.000Z",
          },
          stack: null,
        }) as never;
      yield* supervisor.handleEvent({
        type: "pull-requests",
        threadId: teammate,
        links: [link("open")],
      });
      yield* shell(fake, teammate, { pullRequests: [link("open")] });
      const { decision } = yield* pivots.openDecision(pivot, {
        teammateThreadId: teammate,
        question: "Merge?",
      });
      yield* pivots.escalateDecision(pivot, {
        decisionId: decision.decisionId,
        questions: ["Merge?"],
        evidence: "Green.",
        consequence: "Ships.",
        options: ["Merge"],
        recommendation: "Merge",
        asksApproval: true,
      });
      yield* pivots.recordUserAnswer({
        decisionId: decision.decisionId,
        answer: "Merge it.",
        approved: true,
      });
      yield* tick;
      const before = wakesFor(fake, pivot).length;
      fake.pullRequests.set("https://github.com/o/r/pull/7", {
        provider: "github",
        state: "open",
        isDraft: false,
        mergeability: "mergeable",
        headSha: "abc",
        checks: [],
      });
      yield* pivots.mergeTeammate(pivot, { threadId: teammate, decisionId: decision.decisionId });
      yield* supervisor.handleEvent({
        type: "pull-requests",
        threadId: teammate,
        links: [link("merged")],
      });
      yield* tick;
      assert.strictEqual(wakesFor(fake, pivot).length, before);
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("a takeover opens the new Pivot with a digest of every teammate and decision", () => {
    const { fake } = setup();
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake);
      const pivots = yield* PivotService.PivotService;
      yield* finish(fake, teammate, "blocked");
      const successor = (yield* pivots.create({ projectId, modelSelection, takeover: true }))
        .threadId;
      yield* tick;
      assert.deepStrictEqual(wakesFor(fake, pivot), []);
      const [digest] = wakesFor(fake, successor);
      assert.strictEqual(digest?.summary, "Took over 1 teammate · 1 decision open");
      assert.include(digest!.text, `You took over from the retired Pivot in thread ${pivot}`);
      assert.include(digest!.text, '"Fix the login bug"');
      assert.include(digest!.text, "Open decisions:");
    }).pipe(Effect.provide(withSupervisor(fake)));
  });

  it.effect("the first wake after a restart is a digest", () => {
    const { fake } = setup();
    // The records outlive the supervisor; a second supervisor stands in for the restart.
    const records = harness(fake);
    return Effect.gen(function* () {
      const { pivot, teammate } = yield* running(fake).pipe(Effect.provide(PivotSupervisor.layer));
      const store = yield* PivotStore.PivotStore;
      yield* store.dispatch({ type: "teammate.set-resume", threadId: teammate, resume: "failed" });

      yield* tick.pipe(Effect.provide(PivotSupervisor.layer));
      const [digest] = wakesFor(fake, pivot);
      assert.strictEqual(digest?.summary, "Restart: 1 teammate");
      assert.include(digest!.text, "The server restarted.");
      assert.include(digest!.text, "(did not survive the restart)");
    }).pipe(Effect.provide(records));
  });

  describe("after a restart", () => {
    it.effect(
      "a Pivot and its live teammates carry on, and the Pivot gets no browser tools",
      () => {
        const { fake } = setup();
        return Effect.gen(function* () {
          const { pivot, teammate } = yield* running(fake);
          const carryOn = yield* RestartCarryOn;
          assert.isTrue(yield* carryOn.carriesOn(pivot));
          assert.isTrue(yield* carryOn.carriesOn(teammate));
          assert.isFalse(yield* carryOn.carriesOn("ordinary-thread" as ThreadId));

          const restrictions = yield* ThreadToolRestrictions;
          assert.isTrue(yield* restrictions.withoutBrowserOrDevice(pivot));
          assert.isFalse(yield* restrictions.withoutBrowserOrDevice(teammate));

          yield* carryOn.resuming(teammate);
          const store = yield* PivotStore.PivotStore;
          assert.strictEqual((yield* store.getTeammate(teammate))?.resume, "pending");
        }).pipe(
          Effect.provide(
            Layer.mergeAll(PivotCarryOn.layer, PivotToolRestrictions.layer).pipe(
              Layer.provideMerge(withSupervisor(fake)),
            ),
          ),
        );
      },
    );

    it.effect("releases held queues, resumes teammates, and opens with a digest", () => {
      const { fake } = setup();
      const records = harness(fake);
      return Effect.gen(function* () {
        // Before the restart: a Pivot with two running teammates.
        const first = yield* running(fake, "First task").pipe(
          Effect.provide(PivotSupervisor.layer),
        );
        const second = yield* running(fake, "Second task").pipe(
          Effect.provide(PivotSupervisor.layer),
        );
        // Restart recovery cut both runs and scheduled them to resume.
        const store = yield* PivotStore.PivotStore;
        for (const teammate of [first.teammate, second.teammate]) {
          yield* store.dispatch({
            type: "teammate.set-resume",
            threadId: teammate,
            resume: "pending",
          });
          const thread = fake.threads.get(teammate)!;
          thread.shell = { ...thread.shell, status: "idle", activeRunId: null };
        }

        yield* Effect.gen(function* () {
          yield* tick;
          assert.includeMembers(fake.releasedQueues, [
            first.pivot,
            first.teammate,
            second.teammate,
          ]);
          const [digest] = wakesFor(fake, first.pivot);
          assert.strictEqual(digest?.summary, "Restart: 2 teammates");
          assert.include(digest!.text, '"First task"');
          assert.include(digest!.text, "working (resuming after the restart)");

          // The first comes back; the second never does.
          yield* shell(fake, first.teammate, { status: "running" });
          yield* tick;
          assert.isNull((yield* store.getTeammate(first.teammate))?.resume);
          assert.strictEqual((yield* store.getTeammate(second.teammate))?.resume, "pending");
          yield* TestClock.adjust("5 minutes");
          yield* tick;
          assert.strictEqual((yield* store.getTeammate(second.teammate))?.resume, "failed");
          const [, failed] = wakesFor(fake, first.pivot);
          assert.include(failed!.text, '"Second task"');
          assert.include(failed!.text, "failed (did not survive the restart)");
        }).pipe(Effect.provide(PivotSupervisor.layer));
      }).pipe(Effect.provide(records));
    });
  });
});
