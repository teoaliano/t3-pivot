// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import * as PivotService from "./PivotService.ts";
import { modelSelection, projectId, setup } from "./PivotService.testkit.ts";
import * as PivotStore from "./PivotStore.ts";
import { renderTeammateModels } from "./pivotTeammateModels.ts";
import { loadPivotText } from "./pivotTexts.ts";

const refusal = <A, R>(effect: Effect.Effect<A, PivotService.PivotServiceError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

describe("PivotService.create", () => {
  it.effect("creates a Pivot thread in its home, recorded and read back from the stream", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const config = yield* ServerConfig.ServerConfig;

      const created = yield* pivots.create({ projectId, modelSelection, takeover: false });

      assert.isNull(created.predecessorThreadId);
      const thread = fake.threads.get(created.threadId);
      assert.strictEqual(thread?.kind, "pivot");
      assert.strictEqual(
        thread?.worktreePath,
        NodePath.join(config.stateDir, "pivot-homes", projectId),
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(thread!.worktreePath!, "AGENTS.md")));
      const pivot = yield* store.getActivePivot(projectId);
      assert.strictEqual(pivot?.threadId, created.threadId);
    }).pipe(Effect.provide(layer));
  });

  it.effect("archives the new thread when recording it fails", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      // V2 hands out an id the Pivot store already knows, so recording refuses.
      const taken = ThreadId.make("taken-thread");
      yield* store.dispatch({
        type: "pivot.create",
        threadId: taken,
        projectId: ProjectId.make("project-elsewhere"),
        homePath: "/x",
        takeover: false,
      });
      fake.nextThreadId = taken;

      yield* pivots.create({ projectId, modelSelection, takeover: false }).pipe(Effect.flip);

      assert.isTrue(fake.threads.get(taken)?.archived);
      assert.isNull(yield* store.getActivePivot(projectId));
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses a second Pivot while one is active, and creates nothing", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      yield* pivots.create({ projectId, modelSelection, takeover: false });
      const reason = yield* refusal(pivots.create({ projectId, modelSelection, takeover: false }));
      assert.include(reason, "already has an active Pivot");
      assert.strictEqual(fake.threads.size, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses a project that is not a git repository", () => {
    const { fake, layer } = setup({ git: false });
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const reason = yield* refusal(pivots.create({ projectId, modelSelection, takeover: false }));
      assert.include(reason, "git repository");
      assert.strictEqual(fake.threads.size, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("a takeover retires and settles the active Pivot", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const first = yield* pivots.create({ projectId, modelSelection, takeover: false });
      const second = yield* pivots.create({ projectId, modelSelection, takeover: true });
      assert.strictEqual(second.predecessorThreadId, first.threadId);
      assert.isNotNull((yield* store.getPivot(first.threadId))?.retiredAt);
      assert.strictEqual((yield* store.getActivePivot(projectId))?.threadId, second.threadId);
      assert.isTrue(fake.threads.get(first.threadId)?.settled);
      assert.isFalse(fake.threads.get(second.threadId)?.settled);
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotService.refreshHomes", () => {
  it.effect("brings an active Pivot's contract up to this release and keeps preferences", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const created = yield* pivots.create({ projectId, modelSelection, takeover: false });
      const home = (yield* store.getPivot(created.threadId))!.homePath;
      // What an older release left behind, plus rules the user wrote themselves.
      NodeFS.writeFileSync(NodePath.join(home, "AGENTS.md"), "# Old contract\n");
      NodeFS.writeFileSync(NodePath.join(home, "preferences.md"), "Never merge on Fridays.\n");

      yield* pivots.refreshHomes;

      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(home, "AGENTS.md"), "utf8"),
        (yield* loadPivotText("AGENTS")).replace("{{teammateModels}}", renderTeammateModels([])),
      );
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(home, "preferences.md"), "utf8"),
        "Never merge on Fridays.\n",
      );
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotService.decisionLog", () => {
  it.effect("lists a Pivot's decisions newest first, with how each closed", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const pivot = (yield* pivots.create({ projectId, modelSelection, takeover: false })).threadId;
      const answered = (yield* pivots.openDecision(pivot, { key: "naming", question: "Name?" }))
        .decision;
      yield* pivots.answerDecision(pivot, {
        decisionId: answered.decisionId,
        answer: "Use the existing name.",
      });
      const moot = (yield* pivots.openDecision(pivot, { key: "port", question: "Which port?" }))
        .decision;
      yield* pivots.markDecisionMoot(pivot, {
        decisionId: moot.decisionId,
        evidence: "The port is configured.",
      });
      yield* pivots.openDecision(pivot, { key: "deploy", question: "Deploy today?" });

      const log = yield* pivots.decisionLog(pivot);
      assert.deepStrictEqual(
        log.map((decision) => [decision.summary, decision.resolution?.kind ?? null]),
        [
          ["Deploy today?", null],
          ["Which port?", "moot"],
          ["Name?", "answered"],
        ],
      );
      assert.strictEqual(log[2]?.resolution?.text, "Use the existing name.");
      assert.isNull(log[2]?.userAnswer);

      const notAPivot = yield* refusal(pivots.decisionLog(ThreadId.make("plain-thread")));
      assert.include(notAPivot, "not a Pivot");
    }).pipe(Effect.provide(layer));
  });
});
