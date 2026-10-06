import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type PivotDecisionId,
  type PivotStreamEvent,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as PivotDatabase from "./PivotDatabase.ts";
import * as PivotStore from "./PivotStore.ts";

const TestLayer = PivotStore.layer.pipe(Layer.provide(PivotDatabase.layerMemory));
const withStore = <A, E>(effect: Effect.Effect<A, E, PivotStore.PivotStore>) =>
  Effect.provide(effect, TestLayer);

const projectId = ProjectId.make("project-1");
const pivotA = ThreadId.make("pivot-a");
const pivotB = ThreadId.make("pivot-b");
const shipA = ThreadId.make("ship-a");
const scoutA = ThreadId.make("scout-a");
const run1 = RunId.make("run-1");

const createPivot = (threadId: ThreadId, takeover = false) =>
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return yield* store.dispatch({
      type: "pivot.create",
      threadId,
      projectId,
      homePath: "/home/pivot",
      takeover,
    });
  });

const dispatchTeammate = (
  threadId: ThreadId,
  options: { kind?: "ship" | "scout"; pivotThreadId?: ThreadId; worktreePath?: string | null } = {},
) =>
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return yield* store.dispatch({
      type: "teammate.dispatch",
      pivotThreadId: options.pivotThreadId ?? pivotA,
      threadId,
      projectId,
      kind: options.kind ?? "ship",
      title: `Task ${threadId}`,
      branch: `pivot/${threadId}`,
      baseBranch: "main",
      worktreePath: options.worktreePath === undefined ? `/wt/${threadId}` : options.worktreePath,
      deliveryMode: "direct-pr",
      intent: "Fix the login bug",
      spec: "Reproduce, then fix",
    });
  });

const report = (
  threadId: ThreadId,
  status: "working" | "needs-decision" | "blocked" | "paused" | "done" | "failed",
  extra: Partial<Extract<PivotStore.PivotCommand, { type: "teammate.report" }>> = {},
) =>
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return yield* store.dispatch({
      type: "teammate.report",
      threadId,
      status,
      summary: `${status} summary`,
      until: null,
      runId: run1,
      decisionKey: null,
      clearedDecision: null,
      ...extra,
    });
  });

const refusal = <A>(
  effect: Effect.Effect<
    A,
    PivotStore.PivotRefusedError | PivotStore.PivotStoreError,
    PivotStore.PivotStore
  >,
) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => {
      assert.strictEqual(error._tag, "PivotRefusedError");
      return error.message;
    }),
  );

const openDecisions = (pivotThreadId: ThreadId) =>
  Effect.gen(function* () {
    const store = yield* PivotStore.PivotStore;
    return yield* store.listDecisions({ pivotThreadId, openOnly: true });
  });

describe("PivotStore", () => {
  it.effect("records a Pivot and streams it to clients, then streams what changes", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);

        const fiber = yield* store.stream.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* dispatchTeammate(shipA);
        const events = Array.from(yield* Fiber.join(fiber)) as Array<PivotStreamEvent>;

        const [snapshot, changed] = events;
        assert.strictEqual(snapshot?._tag, "snapshot");
        assert.deepStrictEqual(
          snapshot?.pivots.map((pivot) => [pivot.threadId, pivot.retiredAt]),
          [[pivotA, null]],
        );
        assert.deepStrictEqual(snapshot?.teammates, []);
        assert.strictEqual(changed?._tag, "changed");
        assert.deepStrictEqual(
          changed?.teammates.map((teammate) => [
            teammate.threadId,
            teammate.pivotThreadId,
            teammate.kind,
          ]),
          [[shipA, pivotA, "ship"]],
        );
        // The stream never carries the brief.
        assert.isFalse("intent" in (changed?.teammates[0] ?? {}));
        assert.isFalse("spec" in (changed?.teammates[0] ?? {}));
      }),
    ),
  );

  it.effect("refuses a second Pivot while one is active", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        const reason = yield* refusal(createPivot(pivotB));
        assert.include(reason, "already has an active Pivot");
        assert.strictEqual((yield* store.getActivePivot(projectId))?.threadId, pivotA);
        assert.isNull(yield* store.getPivot(pivotB));
      }),
    ),
  );

  it.effect("records a teammate with its owning Pivot and kind", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        yield* dispatchTeammate(shipA);
        yield* dispatchTeammate(scoutA, { kind: "scout" });

        const teammates = yield* store.listTeammates({
          pivotThreadId: pivotA,
          includeTornDown: false,
        });
        assert.deepStrictEqual(
          teammates.map((teammate) => [teammate.threadId, teammate.kind, teammate.branch]),
          [
            [shipA, "ship", "pivot/ship-a"],
            [scoutA, "scout", "pivot/scout-a"],
          ],
        );
        assert.deepStrictEqual((yield* store.getTeammate(shipA))?.intent, ["Fix the login bug"]);
      }),
    ),
  );

  it.effect("refuses a teammate not dispatched by the active Pivot of its project", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        assert.include(yield* refusal(dispatchTeammate(shipA)), "Only a Pivot");

        yield* createPivot(pivotA);
        yield* createPivot(pivotB, true);
        assert.include(yield* refusal(dispatchTeammate(shipA)), "retired");

        const elsewhere = yield* refusal(
          store.dispatch({
            type: "teammate.dispatch",
            pivotThreadId: pivotB,
            threadId: shipA,
            projectId: ProjectId.make("project-2"),
            kind: "ship",
            title: "x",
            branch: "pivot/x",
            baseBranch: "main",
            worktreePath: "/wt/x",
            deliveryMode: "direct-pr",
            intent: "x",
            spec: "x",
          }),
        );
        assert.include(elsewhere, "own project");
        assert.include(
          yield* refusal(dispatchTeammate(shipA, { pivotThreadId: pivotB, worktreePath: null })),
          "worktree",
        );
        assert.isNull(yield* store.getTeammate(shipA));
      }),
    ),
  );

  it.effect("a takeover moves live teammates and open decisions and retires the old Pivot", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        yield* dispatchTeammate(shipA);
        yield* dispatchTeammate(scoutA, { kind: "scout" });
        yield* report(shipA, "blocked");
        yield* store.dispatch({
          type: "teammate.tear-down",
          pivotThreadId: pivotA,
          threadId: scoutA,
        });

        yield* createPivot(pivotB, true);

        const old = yield* store.getPivot(pivotA);
        assert.isNotNull(old?.retiredAt);
        assert.strictEqual(old?.successorThreadId, pivotB);
        assert.strictEqual((yield* store.getActivePivot(projectId))?.threadId, pivotB);
        // The live teammate moves; the torn-down one stays under its retired Pivot.
        assert.strictEqual((yield* store.getTeammate(shipA))?.pivotThreadId, pivotB);
        assert.strictEqual((yield* store.getTeammate(scoutA))?.pivotThreadId, pivotA);
        assert.deepStrictEqual(
          (yield* openDecisions(pivotB)).map((decision) => decision.teammateThreadId),
          [shipA],
        );
        assert.deepStrictEqual(yield* openDecisions(pivotA), []);
      }),
    ),
  );

  it.effect("a takeover carries the old Pivot's pending wakes", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        yield* dispatchTeammate(shipA);
        yield* store.dispatch({
          type: "teammate.observe-status",
          threadId: shipA,
          status: "done",
          runId: run1,
          detail: null,
          pausedUntil: null,
        });
        yield* createPivot(pivotB, true);
        assert.deepStrictEqual(
          (yield* store.pendingWake(pivotB)).map(({ event }) => event.type),
          ["teammate.status-observed"],
        );
        assert.deepStrictEqual(yield* store.pendingWake(pivotA), []);
      }),
    ),
  );

  it.effect("records reports scoped to their run", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        yield* dispatchTeammate(shipA);
        yield* report(shipA, "working", { summary: "reproduced the bug" });
        const teammate = yield* store.getTeammate(shipA);
        assert.strictEqual(teammate?.report?.status, "working");
        assert.strictEqual(teammate?.report?.runId, run1);
        assert.strictEqual(teammate?.report?.summary, "reproduced the bug");
        assert.include(
          yield* refusal(report(shipA, "done", { until: "2026-10-07T00:00:00.000Z" })),
          "paused",
        );
      }),
    ),
  );

  describe("decisions", () => {
    it.effect("a needs-decision or blocked report opens one, once per key", () =>
      withStore(
        Effect.gen(function* () {
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* report(shipA, "needs-decision", { summary: "Which auth library?" });
          yield* report(shipA, "needs-decision", { summary: "Still waiting" });
          yield* report(shipA, "blocked", { summary: "No credentials", decisionKey: "creds" });
          const decisions = yield* openDecisions(pivotA);
          assert.deepStrictEqual(
            decisions.map((decision) => [decision.key, decision.summary, decision.openedBy]),
            [
              ["default", "Which auth library?", "teammate"],
              ["creds", "No credentials", "teammate"],
            ],
          );
        }),
      ),
    );

    it.effect("the Pivot opens one for itself", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* store.dispatch({
            type: "decision.open",
            pivotThreadId: pivotA,
            teammateThreadId: null,
            key: null,
            summary: "Ship both fixes in one PR?",
          });
          const [decision] = yield* openDecisions(pivotA);
          assert.strictEqual(decision?.openedBy, "pivot");
          assert.isNull(decision?.teammateThreadId);
        }),
      ),
    );

    const escalate = (decisionId: PivotDecisionId) =>
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        return yield* store.dispatch({
          type: "decision.escalate",
          pivotThreadId: pivotA,
          decisionId,
          escalation: {
            questions: ["Drop the legacy endpoint?"],
            evidence: "Nothing called it in 90 days",
            consequence: "Old clients break",
            options: ["Drop it", "Keep it"],
            recommendation: "Drop it",
          },
        });
      });

    it.effect("an escalated decision waits for the user's verbatim answer, then the Pivot's", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* report(shipA, "needs-decision");
          const [opened] = yield* openDecisions(pivotA);
          const decisionId = opened!.decisionId;
          yield* escalate(decisionId);
          assert.strictEqual((yield* store.getPivot(pivotA))?.escalatedDecisionCount, 1);
          assert.isTrue((yield* store.getTeammate(shipA))?.hasEscalatedDecision);

          const answerFirst = yield* refusal(
            store.dispatch({
              type: "decision.answer",
              pivotThreadId: pivotA,
              decisionId,
              text: "Drop it",
            }),
          );
          assert.include(answerFirst, "held for the user");

          const answer = "  Drop it, but log a warning for a release first.  ";
          yield* store.dispatch({ type: "decision.record-user-answer", decisionId, answer });
          assert.strictEqual((yield* store.getDecision(decisionId))?.userAnswer, answer);
          assert.deepStrictEqual(
            (yield* store.pendingWake(pivotA)).map(({ event }) => event.type),
            ["decision.user-answered"],
          );
          assert.include(
            yield* refusal(
              store.dispatch({ type: "decision.record-user-answer", decisionId, answer: "no" }),
            ),
            "already has your answer",
          );

          yield* store.dispatch({
            type: "decision.answer",
            pivotThreadId: pivotA,
            decisionId,
            text: "Drop the endpoint; log a deprecation warning for one release first.",
          });
          const closed = yield* store.getDecision(decisionId);
          assert.strictEqual(closed?.resolution?.kind, "answered");
          assert.strictEqual((yield* store.getPivot(pivotA))?.escalatedDecisionCount, 0);
          assert.include(
            yield* refusal(
              store.dispatch({
                type: "decision.answer",
                pivotThreadId: pivotA,
                decisionId,
                text: "again",
              }),
            ),
            "already closed",
          );
        }),
      ),
    );

    it.effect("refuses a user answer over 8 KB", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* store.dispatch({
            type: "decision.open",
            pivotThreadId: pivotA,
            teammateThreadId: null,
            key: null,
            summary: "Which?",
          });
          const [decision] = yield* openDecisions(pivotA);
          yield* escalate(decision!.decisionId);
          const reason = yield* refusal(
            store.dispatch({
              type: "decision.record-user-answer",
              decisionId: decision!.decisionId,
              answer: "x".repeat(8 * 1024 + 1),
            }),
          );
          assert.include(reason, "8 KB");
        }),
      ),
    );

    it.effect(
      "closes as moot with evidence, and a teammate clears its own unescalated blocker",
      () =>
        withStore(
          Effect.gen(function* () {
            const store = yield* PivotStore.PivotStore;
            yield* createPivot(pivotA);
            yield* dispatchTeammate(shipA);
            yield* report(shipA, "blocked", { decisionKey: "ci" });
            yield* report(shipA, "needs-decision");
            yield* report(shipA, "working", {
              clearedDecision: { key: "ci", resolution: "CI came back on its own" },
            });
            const [remaining] = yield* openDecisions(pivotA);
            assert.strictEqual(remaining?.key, "default");

            yield* escalate(remaining!.decisionId);
            const clearEscalated = yield* refusal(
              report(shipA, "working", { clearedDecision: { key: null, resolution: "gone" } }),
            );
            assert.include(clearEscalated, "escalated");

            yield* store.dispatch({
              type: "decision.mark-moot",
              pivotThreadId: pivotA,
              decisionId: remaining!.decisionId,
              evidence: "The endpoint was removed upstream in #42",
            });
            const moot = yield* store.getDecision(remaining!.decisionId);
            assert.strictEqual(moot?.resolution?.kind, "moot");
            assert.isNull(moot?.userAnswer);
            assert.deepStrictEqual(yield* openDecisions(pivotA), []);
          }),
        ),
    );

    it.effect("never closes on a report or at teardown", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* report(shipA, "needs-decision");
          yield* report(shipA, "working");
          yield* report(shipA, "done");
          yield* report(shipA, "failed");
          yield* store.dispatch({
            type: "teammate.tear-down",
            pivotThreadId: pivotA,
            threadId: shipA,
          });
          assert.strictEqual((yield* openDecisions(pivotA)).length, 1);
        }),
      ),
    );
  });

  describe("wakes", () => {
    const observe = (status: "working" | "done" | "paused" | "unreported", runId = run1) =>
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        return yield* store.dispatch({
          type: "teammate.observe-status",
          threadId: shipA,
          status,
          runId,
          detail: null,
          pausedUntil: null,
        });
      });

    it.effect("pending events are the waking ones after the cursor", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* observe("working");
          assert.deepStrictEqual(yield* store.pendingWake(pivotA), []);
          const [done] = yield* observe("done");
          assert.isTrue(done?.wakes);
          // Observing the same status again records nothing.
          assert.deepStrictEqual(yield* observe("done"), []);

          const pending = yield* store.pendingWake(pivotA);
          assert.deepStrictEqual(
            pending.map(({ sequence }) => sequence),
            [done!.sequence],
          );
          yield* store.dispatch({
            type: "pivot.record-wake",
            threadId: pivotA,
            messageId: MessageId.make("wake-1"),
            fromSequence: 0,
            throughSequence: done!.sequence,
          });
          assert.deepStrictEqual(yield* store.pendingWake(pivotA), []);
          assert.strictEqual((yield* store.getPivot(pivotA))?.wakeCursor, done!.sequence);
        }),
      ),
    );

    it.effect("a status reached in a run the Pivot stopped does not wake it", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* store.dispatch({
            type: "teammate.stop",
            pivotThreadId: pivotA,
            threadId: shipA,
            runId: run1,
          });
          yield* observe("unreported");
          assert.deepStrictEqual(yield* store.pendingWake(pivotA), []);
          yield* observe("done", RunId.make("run-2"));
          assert.strictEqual((yield* store.pendingWake(pivotA)).length, 1);
        }),
      ),
    );

    it.effect("a paused teammate is rechecked at its until, or four hours on", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* store.dispatch({
            type: "teammate.observe-status",
            threadId: shipA,
            status: "paused",
            runId: run1,
            detail: null,
            pausedUntil: "2026-10-07T12:00:00.000Z",
          });
          assert.strictEqual(
            (yield* store.getTeammate(shipA))?.recheckAt,
            "2026-10-07T12:00:00.000Z",
          );
          assert.deepStrictEqual(yield* store.pendingWake(pivotA), []);
          yield* store.dispatch({ type: "teammate.recheck-paused", threadId: shipA });
          assert.strictEqual((yield* store.pendingWake(pivotA)).length, 1);
          const next = (yield* store.getTeammate(shipA))?.recheckAt;
          assert.isTrue(next !== null && next !== "2026-10-07T12:00:00.000Z");
        }),
      ),
    );

    it.effect("marks a teammate stuck once per run", () =>
      withStore(
        Effect.gen(function* () {
          const store = yield* PivotStore.PivotStore;
          yield* createPivot(pivotA);
          yield* dispatchTeammate(shipA);
          yield* store.dispatch({ type: "teammate.mark-stuck", threadId: shipA, runId: run1 });
          yield* store.dispatch({ type: "teammate.mark-stuck", threadId: shipA, runId: run1 });
          assert.strictEqual((yield* store.pendingWake(pivotA)).length, 1);
          yield* store.dispatch({
            type: "teammate.mark-stuck",
            threadId: shipA,
            runId: RunId.make("run-2"),
          });
          assert.strictEqual((yield* store.pendingWake(pivotA)).length, 2);
        }),
      ),
    );
  });

  it.effect("only the owning Pivot acts on a live teammate", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* PivotStore.PivotStore;
        yield* createPivot(pivotA);
        yield* dispatchTeammate(shipA);
        yield* dispatchTeammate(scoutA, { kind: "scout" });
        const stranger = yield* refusal(
          store.dispatch({
            type: "teammate.stop",
            pivotThreadId: shipA,
            threadId: scoutA,
            runId: null,
          }),
        );
        assert.include(stranger, "Only a Pivot");
        assert.include(
          yield* refusal(
            store.dispatch({
              type: "teammate.promote",
              pivotThreadId: pivotA,
              threadId: shipA,
              spec: "s",
            }),
          ),
          "Only a scout",
        );
        yield* store.dispatch({
          type: "teammate.promote",
          pivotThreadId: pivotA,
          threadId: scoutA,
          spec: "Now fix it",
        });
        const promoted = yield* store.getTeammate(scoutA);
        assert.strictEqual(promoted?.kind, "ship");
        assert.strictEqual(promoted?.spec, "Now fix it");
        yield* store.dispatch({
          type: "teammate.add-intent",
          pivotThreadId: pivotA,
          threadId: scoutA,
          text: "Also the logout bug",
        });
        assert.deepStrictEqual((yield* store.getTeammate(scoutA))?.intent, [
          "Fix the login bug",
          "Also the logout bug",
        ]);
        yield* store.dispatch({
          type: "teammate.tear-down",
          pivotThreadId: pivotA,
          threadId: shipA,
        });
        assert.include(
          yield* refusal(
            store.dispatch({
              type: "teammate.stop",
              pivotThreadId: pivotA,
              threadId: shipA,
              runId: null,
            }),
          ),
          "torn down",
        );
      }),
    ),
  );
});
