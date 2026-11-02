// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import * as PivotService from "./PivotService.ts";
import { attachWorktree, modelSelection, projectId, setup, sh } from "./PivotService.testkit.ts";
import * as PivotStore from "./PivotStore.ts";
import * as FakeThreads from "./PivotThreads.testkit.ts";
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

  it.effect("creates the Pivot on the thread id the caller reserved", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      // A New Pivot draft reserves its thread id, so its first send lands on the Pivot.
      const reserved = ThreadId.make("draft-reserved-thread");

      const created = yield* pivots.create({
        projectId,
        modelSelection,
        takeover: false,
        threadId: reserved,
      });

      assert.strictEqual(created.threadId, reserved);
      assert.strictEqual(fake.threads.get(reserved)?.kind, "pivot");
      const pivot = yield* store.getActivePivot(projectId);
      assert.strictEqual(pivot?.threadId, reserved);
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

  it.effect("a takeover retires the active Pivot and leaves it to write its handoff", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const first = yield* pivots.create({ projectId, modelSelection, takeover: false });
      const second = yield* pivots.create({ projectId, modelSelection, takeover: true });
      assert.strictEqual(second.predecessorThreadId, first.threadId);
      assert.isNotNull((yield* store.getPivot(first.threadId))?.retiredAt);
      assert.strictEqual((yield* store.getActivePivot(projectId))?.threadId, second.threadId);
      assert.isFalse(fake.threads.get(first.threadId)?.settled);
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

/** A ship the Pivot dispatched, on a real worktree of the project's repository. */
const dispatchShip = (
  fake: FakeThreads.FakeV2,
  repo: string,
  options: { shipDirectly?: boolean } = {},
) =>
  Effect.gen(function* () {
    const pivots = yield* PivotService.PivotService;
    const pivot = (yield* pivots.create({ projectId, modelSelection, takeover: false })).threadId;
    const dispatched = yield* pivots.dispatchTeammate(pivot, {
      title: "Fix the login bug",
      kind: "ship",
      intent: "Make the login button work on Safari.",
      spec: "Reproduce, fix, test.",
      ...options,
    });
    const worktree = attachWorktree(fake, repo, dispatched.threadId, dispatched.branch);
    return { teammate: dispatched.threadId, branch: dispatched.branch, worktree };
  });

/** Writes a file in the worktree and commits it. */
const commitFile = (worktree: string, name: string) => {
  NodeFS.writeFileSync(NodePath.join(worktree, name), "change\n");
  sh(worktree, `git add -A && git commit -q -m "${name}"`);
};

const done = { status: "done", summary: "Fixed", evidence: { text: "Tests pass." } } as const;

describe("PivotService.reportStatus done", () => {
  it.effect("refuses done for a ship with uncommitted work, and names it", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      NodeFS.writeFileSync(NodePath.join(ship.worktree, "login.ts"), "export {};\n");

      const reason = yield* refusal(pivots.reportStatus(ship.teammate, done));
      assert.include(reason, "login.ts");
      assert.include(reason, "Commit it");
    }).pipe(Effect.provide(layer));
  });

  it.effect("accepts done for a ship whose work is committed", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      commitFile(ship.worktree, "login.ts");

      const reported = yield* pivots.reportStatus(ship.teammate, done);
      assert.strictEqual(reported.status, "done");
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses done for a ship told to ship directly while its commit is unpushed", () => {
    const { fake, workspaceRoot, layer } = setup({ remote: true });
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot, { shipDirectly: true });
      fake.threads.get(ship.teammate)!.shell = {
        linkedPullRequest: {
          projectId,
          repository: "acme/app",
          number: 1,
          url: "https://github.com/acme/app/pull/1",
        },
      };
      commitFile(ship.worktree, "login.ts");

      const reason = yield* refusal(pivots.reportStatus(ship.teammate, done));
      assert.include(reason, "is not pushed");

      sh(ship.worktree, `git push -q -u origin ${ship.branch}`);
      const reported = yield* pivots.reportStatus(ship.teammate, done);
      assert.strictEqual(reported.status, "done");
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotService.teardownTeammate", () => {
  it.effect("removes a landed teammate's worktree and local branch", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      const pivot = (yield* (yield* PivotStore.PivotStore).getTeammate(ship.teammate))!
        .pivotThreadId;
      commitFile(ship.worktree, "login.ts");
      sh(workspaceRoot, `git merge -q --ff-only ${ship.branch}`);

      yield* pivots.teardownTeammate(pivot, { threadId: ship.teammate });

      assert.isFalse(NodeFS.existsSync(ship.worktree));
      assert.strictEqual(sh(workspaceRoot, `git branch --list ${ship.branch}`), "");
      assert.include(sh(workspaceRoot, "git log --format=%s main"), "login.ts");
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses while another teammate is tied to the same worktree", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      const pivot = (yield* (yield* PivotStore.PivotStore).getTeammate(ship.teammate))!
        .pivotThreadId;
      const second = yield* pivots.dispatchTeammate(pivot, {
        title: "Follow up",
        kind: "ship",
        intent: "More.",
        spec: "More.",
      });
      fake.threads.get(second.threadId)!.worktreePath = ship.worktree;
      commitFile(ship.worktree, "login.ts");
      sh(workspaceRoot, `git merge -q --ff-only ${ship.branch}`);

      const reason = yield* refusal(pivots.teardownTeammate(pivot, { threadId: ship.teammate }));

      assert.include(reason, second.threadId);
      assert.isTrue(NodeFS.existsSync(ship.worktree));
      assert.include(sh(workspaceRoot, "git branch"), ship.branch);
    }).pipe(Effect.provide(layer));
  });

  it.effect("still refuses unlanded work and deletes nothing", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      const pivot = (yield* (yield* PivotStore.PivotStore).getTeammate(ship.teammate))!
        .pivotThreadId;
      commitFile(ship.worktree, "login.ts");

      const reason = yield* refusal(pivots.teardownTeammate(pivot, { threadId: ship.teammate }));

      assert.include(reason, "has not landed");
      assert.isTrue(NodeFS.existsSync(ship.worktree));
      assert.include(sh(workspaceRoot, "git branch"), ship.branch);
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotService teammate tools after teardown", () => {
  it.effect("refuses a torn-down teammate's report_status and record_scout_report", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const ship = yield* dispatchShip(fake, workspaceRoot);
      const record = yield* store.getTeammate(ship.teammate);
      yield* store.dispatch({
        type: "teammate.tear-down",
        pivotThreadId: record!.pivotThreadId,
        threadId: ship.teammate,
      });

      assert.strictEqual(
        yield* refusal(pivots.reportStatus(ship.teammate, { status: "working", summary: "Hi" })),
        "This teammate was torn down.",
      );
      assert.strictEqual(
        yield* refusal(pivots.recordScoutReport(ship.teammate, { report: "Hi" })),
        "This teammate was torn down.",
      );
    }).pipe(Effect.provide(layer));
  });
});

describe("PivotService teammate cap", () => {
  it.effect("caps running ships and scouts", () => {
    const { layer } = setup({ settings: { pivotMaxTeammates: 1 } });
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const pivot = (yield* pivots.create({ projectId, modelSelection, takeover: false })).threadId;
      yield* pivots.dispatchTeammate(pivot, {
        title: "Fix the login bug",
        kind: "ship",
        intent: "Make the login button work on Safari.",
        spec: "Reproduce, fix, test.",
      });
      const refused = yield* refusal(
        pivots.dispatchTeammate(pivot, {
          title: "Look into the flaky test",
          kind: "scout",
          intent: "Why does the test flake?",
          spec: "Find out.",
        }),
      );
      assert.include(refused, "the most at once (1)");
    }).pipe(Effect.provide(layer));
  });
});
