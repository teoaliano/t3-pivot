// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type PivotMcpDispatchTeammateResult,
  RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as PivotService from "../../../pivot/PivotService.ts";
import {
  addWorktree,
  modelSelection,
  projectId,
  setup,
  sh,
} from "../../../pivot/PivotService.testkit.ts";
import * as PivotStore from "../../../pivot/PivotStore.ts";
import type { FakeV2 } from "../../../pivot/PivotThreads.testkit.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { PivotToolkitHandlersLive, TeammateToolkitHandlersLive } from "./handlers.ts";
import { PivotToolkit, TeammateToolkit } from "./tools.ts";

const invocation = (threadId: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration", "worktree", "pull-requests"]),
  issuedAt: 1,
});

type Outcome =
  | { readonly ok: true; readonly value: any }
  | { readonly ok: false; readonly code: string; readonly message: string };

const toolkits = Effect.gen(function* () {
  const pivotToolkit = yield* PivotToolkit;
  const teammateToolkit = yield* TeammateToolkit;
  return { pivotToolkit, teammateToolkit };
}).pipe(Effect.provide(Layer.mergeAll(PivotToolkitHandlersLive, TeammateToolkitHandlersLive)));

/** Calls a Pivot or teammate tool as `caller` and returns what the agent would see. */
const call = (
  caller: ThreadId,
  name: string,
  params: Record<string, unknown>,
): Effect.Effect<Outcome, never, PivotService.PivotService> =>
  Effect.gen(function* () {
    const { pivotToolkit, teammateToolkit } = yield* toolkits;
    const toolkit = name in pivotToolkit.tools ? pivotToolkit : teammateToolkit;
    // The tool name is chosen at runtime, so the handler's types are erased here.
    const handle = toolkit.handle as unknown as (
      name: string,
      params: unknown,
    ) => Effect.Effect<Stream.Stream<{ isFailure: boolean; result: any }>>;
    const chunks = yield* handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(caller)),
    );
    const last = Array.from(chunks).at(-1)!;
    return last.isFailure
      ? { ok: false as const, code: last.result.code ?? "parameters", message: last.result.message }
      : { ok: true as const, value: last.result };
  }).pipe(Effect.orDie) as Effect.Effect<Outcome, never, PivotService.PivotService>;

const expectOk = (outcome: Outcome) => {
  if (!outcome.ok) assert.fail(`expected success, got ${outcome.code}: ${outcome.message}`);
  return outcome.value;
};
const expectRefused = (outcome: Outcome, code: string, includes?: string) => {
  assert.isFalse(outcome.ok, "expected a refusal");
  if (outcome.ok) return;
  assert.strictEqual(outcome.code, code, outcome.message);
  if (includes !== undefined) assert.include(outcome.message, includes);
};

const createPivot = Effect.gen(function* () {
  const pivots = yield* PivotService.PivotService;
  return (yield* pivots.create({ projectId, modelSelection, takeover: false })).threadId;
});

const dispatch = (
  pivot: ThreadId,
  params: Partial<{ title: string; kind: "ship" | "scout"; intent: string; spec: string }> = {},
) =>
  call(pivot, "dispatch_teammate", {
    title: "Fix the login bug",
    kind: "ship",
    intent: "The login button does nothing on Safari. Make it work.",
    spec: "Reproduce in Safari, fix the handler, add a regression test.",
    ...params,
  }).pipe(Effect.map((outcome) => expectOk(outcome) as PivotMcpDispatchTeammateResult));

const firstMessage = (fake: FakeV2, threadId: ThreadId) => fake.threads.get(threadId)?.messages[0];
const lastMessage = (fake: FakeV2, threadId: ThreadId) =>
  fake.threads.get(threadId)?.messages.at(-1);

describe("Pivot and teammate tools", () => {
  it.effect("only the active Pivot uses Pivot tools, and only teammates use teammate tools", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const teammate = (yield* dispatch(pivot)).threadId;
      const stranger = "some-other-thread" as ThreadId;

      expectRefused(
        yield* call(stranger, "list_teammates", {}),
        "capability_denied",
        "Only a Pivot",
      );
      expectRefused(yield* call(teammate, "list_teammates", {}), "capability_denied");
      expectRefused(
        yield* call(pivot, "report_status", { status: "working", summary: "x" }),
        "capability_denied",
        "Only a teammate",
      );
      expectRefused(
        yield* call(stranger, "report_status", { status: "working", summary: "x" }),
        "capability_denied",
      );

      const pivots = yield* PivotService.PivotService;
      const successor = (yield* pivots.create({ projectId, modelSelection, takeover: true }))
        .threadId;
      expectRefused(yield* call(pivot, "list_teammates", {}), "capability_denied", "retired");
      const lines = expectOk(yield* call(successor, "list_teammates", {}));
      assert.deepStrictEqual(
        lines.teammates.map((line: { threadId: ThreadId }) => line.threadId),
        [teammate],
      );
    }).pipe(Effect.provide(layer));
  });

  describe("dispatch_teammate", () => {
    it.effect("launches a ship with the brief as the Pivot's first message on pivot/<slug>", () => {
      const { fake, layer } = setup({ remote: true });
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const result = yield* dispatch(pivot);

        assert.strictEqual(result.branch, "pivot/fix-the-login-bug");
        assert.strictEqual(result.baseBranch, "main");
        assert.strictEqual(result.deliveryMode, "direct-pr");
        assert.strictEqual(result.firstRun, "started");
        assert.isTrue(
          result.worktreePath.endsWith(NodePath.join("work", "pivot-fix-the-login-bug")),
        );

        const thread = fake.threads.get(result.threadId)!;
        assert.strictEqual(thread.branch, "pivot/fix-the-login-bug");
        assert.strictEqual(thread.baseBranch, "main");
        const brief = firstMessage(fake, result.threadId)!;
        assert.strictEqual(brief.senderThreadId, pivot);
        // The role comes first, so project instructions cannot reassign it.
        assert.isTrue(brief.text.startsWith("# Your role"));
        assert.include(brief.text, "The login button does nothing on Safari. Make it work.");
        assert.include(brief.text, "Reproduce in Safari, fix the handler, add a regression test.");
        assert.include(brief.text, "This task delivers a pull request.");
        assert.include(brief.text, `Your worktree is \`${result.worktreePath}\``);
        assert.notInclude(brief.text, "{{");
        assert.notInclude(brief.text, "<!--");

        const second = yield* dispatch(pivot);
        assert.strictEqual(second.branch, "pivot/fix-the-login-bug-2");
      }).pipe(Effect.provide(layer));
    });

    it.effect("delivers a ready branch in a project with no remote", () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const result = yield* dispatch(pivot);
        assert.strictEqual(result.deliveryMode, "local-only");
        assert.include(
          firstMessage(fake, result.threadId)!.text,
          "This task delivers a ready branch.",
        );
      }).pipe(Effect.provide(layer));
    });

    it.effect("uses the project's default model, then the Pivot's own", () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const own = yield* dispatch(pivot);
        assert.deepStrictEqual(fake.threads.get(own.threadId)?.modelSelection, modelSelection);

        const projectDefault = { instanceId: ProviderInstanceId.make("claude"), model: "claude-x" };
        const project = fake.projects.get(projectId)!;
        fake.projects.set(projectId, { ...project, defaultModelSelection: projectDefault });
        const defaulted = yield* dispatch(pivot, { title: "Second" });
        assert.deepStrictEqual(
          fake.threads.get(defaulted.threadId)?.modelSelection,
          projectDefault,
        );
      }).pipe(Effect.provide(layer));
    });

    it.effect("a failed launch reads failed, keeps its worktree, and relaunch retries it", () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        fake.nextLaunch = {
          worktreePath: "/worktrees/x",
          start: {
            type: "failed",
            runId: RunId.make("run-1"),
            detail: "Setup script exited with 1.",
          },
        };
        const result = yield* dispatch(pivot);
        assert.strictEqual(result.firstRun, "failed");
        assert.strictEqual(result.detail, "Setup script exited with 1.");
        const store = yield* PivotStore.PivotStore;
        assert.isNotNull(yield* store.getTeammate(result.threadId));

        const thread = fake.threads.get(result.threadId)!;
        thread.shell = { ...thread.shell, status: "failed", latestRunStartedAt: null };
        const relaunched = expectOk(
          yield* call(pivot, "relaunch_teammate", { threadId: result.threadId }),
        );
        assert.strictEqual(relaunched.outcome, "relaunched");
        assert.strictEqual(thread.relaunches, 1);
        // A retried launch sends no new message; the brief is still the first one.
        assert.strictEqual(thread.messages.length, 1);
      }).pipe(Effect.provide(layer));
    });

    it.effect("refuses an empty intent or spec, or an intent opening with a speaker label", () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const base = { title: "T", kind: "ship", intent: "Fix it", spec: "Do it" };
        assert.isFalse((yield* call(pivot, "dispatch_teammate", { ...base, intent: "  " })).ok);
        assert.isFalse((yield* call(pivot, "dispatch_teammate", { ...base, spec: "" })).ok);
        expectRefused(
          yield* call(pivot, "dispatch_teammate", { ...base, intent: "User: fix the login bug" }),
          "invalid_request",
          "speaker label",
        );
        expectRefused(
          yield* call(pivot, "dispatch_teammate", { ...base, intent: "the user said: fix it" }),
          "invalid_request",
        );
        assert.strictEqual(
          [...fake.threads.values()].filter((thread) => thread.kind === "teammate").length,
          0,
        );
      }).pipe(Effect.provide(layer));
    });
  });

  it.effect("a scout reports, then is promoted in place with a superseding contract", () => {
    const { fake, layer } = setup({ remote: true });
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const scout = yield* dispatch(pivot, { title: "Why is login slow", kind: "scout" });
      assert.include(firstMessage(fake, scout.threadId)!.text, "This task delivers a report");

      expectOk(
        yield* call(scout.threadId, "record_scout_report", {
          report: "The session lookup does a full table scan; see db.ts:42.",
        }),
      );
      const pivots = yield* PivotService.PivotService;
      const detail = yield* pivots.teammateDetail(scout.threadId);
      assert.strictEqual(
        detail.scoutReport,
        "The session lookup does a full table scan; see db.ts:42.",
      );

      const promoted = expectOk(
        yield* call(pivot, "promote_scout", { threadId: scout.threadId, spec: "Add the index." }),
      );
      assert.strictEqual(promoted.kind, "ship");
      const message = lastMessage(fake, scout.threadId)!;
      assert.strictEqual(message.senderThreadId, pivot);
      assert.isTrue(message.text.startsWith("# You are now a ship"));
      assert.include(message.text, "The login button does nothing on Safari. Make it work.");
      assert.include(message.text, "Add the index.");
      assert.include(message.text, "This task delivers a pull request.");
      expectRefused(
        yield* call(pivot, "promote_scout", { threadId: scout.threadId, spec: "again" }),
        "invalid_request",
        "Only a scout",
      );
      expectRefused(
        yield* call(scout.threadId, "record_scout_report", { report: "more" }),
        "invalid_request",
        "Only a scout",
      );
    }).pipe(Effect.provide(layer));
  });

  describe("report_status", () => {
    it.effect("records the report on the run it was made in and streams it", () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const ship = yield* dispatch(pivot);
        const thread = fake.threads.get(ship.threadId)!;
        thread.shell = { ...thread.shell, latestRunId: RunId.make("run-7") };

        expectOk(
          yield* call(ship.threadId, "report_status", { status: "working", summary: "Reproduced" }),
        );
        const store = yield* PivotStore.PivotStore;
        const [snapshot] = Array.from(yield* store.stream.pipe(Stream.take(1), Stream.runCollect));
        const record = snapshot?._tag === "snapshot" ? snapshot.teammates[0] : undefined;
        assert.strictEqual(record?.report?.status, "working");
        assert.strictEqual(record?.report?.summary, "Reproduced");
        assert.strictEqual(record?.report?.runId, "run-7");

        const blocked = expectOk(
          yield* call(ship.threadId, "report_status", { status: "blocked", summary: "No API key" }),
        );
        assert.strictEqual(blocked.openDecisions, 1);
      }).pipe(Effect.provide(layer));
    });

    it.effect("refuses a ship's done in PR mode until a linked PR has its pushed head", () => {
      const { fake, workspaceRoot, layer } = setup({ remote: true });
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const ship = yield* dispatch(pivot);
        addWorktree(workspaceRoot, ship.worktreePath, ship.branch);
        NodeFS.writeFileSync(NodePath.join(ship.worktreePath, "fix.txt"), "fixed\n");
        sh(ship.worktreePath, "git add -A && git commit -q -m fix");
        const done = { status: "done", summary: "Fixed: https://github.com/o/r/pull/1" };

        expectRefused(
          yield* call(ship.threadId, "report_status", done),
          "invalid_request",
          "linked PR",
        );

        const thread = fake.threads.get(ship.threadId)!;
        thread.shell = {
          ...thread.shell,
          pullRequests: [
            {
              host: "github.com",
              repository: "o/r",
              number: 1,
              url: "https://github.com/o/r/pull/1",
              source: "agent",
              linkedAt: "2026-10-06T00:00:00.000Z",
              snapshot: null,
              stack: null,
            },
          ],
        } as typeof thread.shell;
        expectRefused(
          yield* call(ship.threadId, "report_status", done),
          "invalid_request",
          "not pushed",
        );

        sh(ship.worktreePath, `git push -q origin ${ship.branch}`);
        NodeFS.writeFileSync(NodePath.join(ship.worktreePath, "more.txt"), "more\n");
        sh(ship.worktreePath, "git add -A && git commit -q -m more");
        expectRefused(
          yield* call(ship.threadId, "report_status", done),
          "invalid_request",
          "origin has",
        );

        sh(ship.worktreePath, `git push -q origin ${ship.branch}`);
        expectOk(yield* call(ship.threadId, "report_status", done));
      }).pipe(Effect.provide(layer));
    });

    it.effect("accepts a local-only ship's done naming its branch", () => {
      const { layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const ship = yield* dispatch(pivot);
        expectOk(
          yield* call(ship.threadId, "report_status", {
            status: "done",
            summary: `Ready on ${ship.branch}`,
          }),
        );
      }).pipe(Effect.provide(layer));
    });
  });

  it.effect("lists teammates and reads bounded history, scoped to the calling Pivot", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const ship = yield* dispatch(pivot);
      for (let index = 0; index < 5; index += 1) {
        expectOk(
          yield* call(ship.threadId, "report_status", {
            status: "working",
            summary: `Step ${index}`,
          }),
        );
      }

      const listed = expectOk(yield* call(pivot, "list_teammates", {}));
      assert.strictEqual(listed.teammates.length, 1);
      const line = listed.teammates[0];
      assert.deepInclude(line, {
        threadId: ship.threadId,
        title: "Fix the login bug",
        kind: "ship",
        branch: "pivot/fix-the-login-bug",
        worktreePath: ship.worktreePath,
        summary: "Step 4",
        tornDown: false,
      });

      const first = expectOk(
        yield* call(pivot, "teammate_history", { threadId: ship.threadId, limit: 3 }),
      );
      assert.deepStrictEqual(
        first.entries.map((entry: { line: string }) => entry.line),
        ["Reported working: Step 4", "Reported working: Step 3", "Reported working: Step 2"],
      );
      const rest = expectOk(
        yield* call(pivot, "teammate_history", {
          threadId: ship.threadId,
          beforeSequence: first.nextBeforeSequence,
          limit: 10,
        }),
      );
      assert.deepStrictEqual(
        rest.entries.map((entry: { line: string }) => entry.line),
        [
          "Reported working: Step 1",
          "Reported working: Step 0",
          "Dispatched as a ship on pivot/fix-the-login-bug from main.",
        ],
      );
      assert.isNull(rest.nextBeforeSequence);

      // Another project's Pivot sees none of it.
      const otherProject = ProjectId.make("project-2");
      fake.projects.set(otherProject, {
        ...fake.projects.get(projectId)!,
        projectId: otherProject,
      });
      const pivots = yield* PivotService.PivotService;
      const other = (yield* pivots.create({
        projectId: otherProject,
        modelSelection,
        takeover: false,
      })).threadId;
      assert.deepStrictEqual(expectOk(yield* call(other, "list_teammates", {})).teammates, []);
      expectRefused(
        yield* call(other, "teammate_history", { threadId: ship.threadId }),
        "invalid_request",
        "not one of your teammates",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("records the user's new words on the intent and sends them", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const ship = yield* dispatch(pivot);
      const result = expectOk(
        yield* call(pivot, "add_intent", {
          threadId: ship.threadId,
          intent: "Also keep the old button style.",
          text: "Keep this in the same PR.",
        }),
      );
      assert.deepStrictEqual(result.intent, [
        "The login button does nothing on Safari. Make it work.",
        "Also keep the old button style.",
      ]);
      const message = lastMessage(fake, ship.threadId)!;
      assert.strictEqual(message.senderThreadId, pivot);
      assert.strictEqual(message.mode, "queue");
      assert.include(message.text, "Also keep the old button style.");
      assert.include(message.text, "Keep this in the same PR.");
    }).pipe(Effect.provide(layer));
  });

  it.effect("stops and relaunches its own teammates and reports a failed relaunch", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const ship = yield* dispatch(pivot);
      expectOk(yield* call(pivot, "stop_teammate", { threadId: ship.threadId }));
      assert.strictEqual(fake.threads.get(ship.threadId)?.stops, 1);

      const relaunched = expectOk(
        yield* call(pivot, "relaunch_teammate", { threadId: ship.threadId }),
      );
      assert.strictEqual(relaunched.outcome, "relaunched");
      assert.strictEqual(lastMessage(fake, ship.threadId)?.mode, "relaunch");

      fake.nextRelaunch = { type: "failed", runId: null, detail: "Provider unavailable." };
      const failed = expectOk(yield* call(pivot, "relaunch_teammate", { threadId: ship.threadId }));
      assert.strictEqual(failed.outcome, "relaunch-failed");
      assert.strictEqual(failed.detail, "Provider unavailable.");

      expectRefused(
        yield* call(pivot, "stop_teammate", { threadId: pivot }),
        "invalid_request",
        "not one of your teammates",
      );
      expectRefused(yield* call(pivot, "stop_teammate", { threadId: "nobody" }), "invalid_request");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "an escalated decision waits for the user, and the Pivot's answer reaches the teammate",
    () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const pivot = yield* createPivot;
        const ship = yield* dispatch(pivot);
        expectOk(
          yield* call(ship.threadId, "report_status", {
            status: "needs-decision",
            summary: "Drop the legacy endpoint?",
          }),
        );
        const store = yield* PivotStore.PivotStore;
        const [decision] = yield* store.listDecisions({ pivotThreadId: pivot, openOnly: true });
        const decisionId = decision!.decisionId;

        expectOk(
          yield* call(pivot, "escalate_decision", {
            decisionId,
            questions: ["Drop the legacy endpoint?"],
            evidence: "No calls in 90 days.",
            consequence: "Old clients break.",
            options: ["Drop it", "Keep it"],
            recommendation: "Drop it",
          }),
        );
        expectRefused(
          yield* call(pivot, "answer_decision", { decisionId, answer: "Drop it" }),
          "invalid_request",
          "held for the user",
        );

        const pivots = yield* PivotService.PivotService;
        yield* pivots.recordUserAnswer({
          decisionId,
          answer: "Drop it, after one release with a warning.",
        });
        const answered = expectOk(
          yield* call(pivot, "answer_decision", {
            decisionId,
            answer:
              "Keep the endpoint for one more release with a deprecation warning, then remove it.",
          }),
        );
        assert.strictEqual(answered.decision.resolution.kind, "answered");
        assert.strictEqual(
          answered.decision.userAnswer,
          "Drop it, after one release with a warning.",
        );
        const message = lastMessage(fake, ship.threadId)!;
        assert.strictEqual(message.senderThreadId, pivot);
        assert.include(message.text, "deprecation warning");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("a failed send leaves the decision open", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const pivot = yield* createPivot;
      const ship = yield* dispatch(pivot);
      expectOk(
        yield* call(ship.threadId, "report_status", { status: "blocked", summary: "Which DB?" }),
      );
      const store = yield* PivotStore.PivotStore;
      const [decision] = yield* store.listDecisions({ pivotThreadId: pivot, openOnly: true });
      fake.failSend = true;
      expectRefused(
        yield* call(pivot, "answer_decision", {
          decisionId: decision!.decisionId,
          answer: "Postgres",
        }),
        "orchestration_error",
      );
      assert.strictEqual(
        (yield* store.listDecisions({ pivotThreadId: pivot, openOnly: true })).length,
        1,
      );
    }).pipe(Effect.provide(layer));
  });
});
