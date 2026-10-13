// @effect-diagnostics nodeBuiltinImport:off
/**
 * Every operation of the seam, through LocalTeammateHost, answers exactly what the
 * underlying PivotThreads and PivotGit answer for the same input.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import { attachWorktree, modelSelection, projectId, setup, sh } from "./PivotService.testkit.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotThreads from "./PivotThreads.ts";
import { TeammateHost } from "./TeammateHost.ts";
import { ClaudeTempRoot, claudeTempName } from "./teammateTemp.ts";
import type { FakeV2 } from "./PivotThreads.testkit.ts";

const pivotThreadId = ThreadId.make("pivot-thread");

const launchInput = {
  projectId,
  pivotThreadId,
  title: "Fix the login bug",
  kind: "ship",
  intent: "Make the login button work on Safari.",
  spec: "Reproduce, fix, test.",
  modelSelection,
} as const;

/** A launched teammate with a real worktree of the repository. */
const launched = (fake: FakeV2, repo: string) =>
  Effect.gen(function* () {
    const host = yield* TeammateHost;
    const teammate = yield* host.launch(launchInput);
    const worktree = attachWorktree(fake, repo, teammate.threadId, teammate.branch);
    return {
      teammate,
      worktree,
      checkout: { projectId, worktreePath: worktree, branch: teammate.branch },
    };
  });

describe("TeammateHost (local)", () => {
  it.effect(
    "project refuses what the service refused: a missing project and a non-repository",
    () => {
      const { layer } = setup({ git: false });
      return Effect.gen(function* () {
        const host = yield* TeammateHost;
        const notGit = yield* host.project("dispatch_teammate", projectId).pipe(Effect.flip);
        assert.include(notGit.message, "needs a git repository");
        const gone = yield* host
          .project("dispatch_teammate", "project-gone" as typeof projectId)
          .pipe(Effect.flip);
        assert.strictEqual(gone.message, "Project project-gone was not found.");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("project returns the project PivotThreads reads", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const threads = yield* PivotThreads.PivotThreads;
      assert.deepStrictEqual(
        yield* host.project("dispatch_teammate", projectId),
        yield* threads.project(projectId),
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "launch picks the branch and worktree, and sends the brief as the first message",
    () => {
      const { fake, layer } = setup({ remote: true });
      return Effect.gen(function* () {
        const host = yield* TeammateHost;
        const config = yield* ServerConfig.ServerConfig;
        const result = yield* host.launch(launchInput);

        assert.strictEqual(result.baseBranch, "main");
        assert.strictEqual(result.deliveryMode, "direct-pr");
        assert.match(result.branch, /^pivot\/fix-the-login-bug/);
        assert.strictEqual(
          result.worktreePath,
          NodePath.join(
            config.worktreesDir,
            NodePath.basename(fake.projects.get(projectId)!.workspaceRoot),
            result.branch.replace(/\//g, "-"),
          ),
        );
        const thread = fake.threads.get(result.threadId)!;
        assert.strictEqual(thread.branch, result.branch);
        assert.strictEqual(thread.messages[0]?.senderThreadId, pivotThreadId);
        assert.include(thread.messages[0]?.text, launchInput.intent);
        assert.include(thread.messages[0]?.text, result.branch);
        assert.include(thread.messages[0]?.text, "timeout 600 <command>");
        assert.include(thread.messages[0]?.text, "Don't leave dev servers");
        assert.strictEqual(result.runId, fake.threads.get(result.threadId)!.shell.latestRunId);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("launch on a project without a remote is local-only, and honors a base branch", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const result = yield* host.launch({ ...launchInput, baseBranch: "pivot/other" });
      assert.strictEqual(result.deliveryMode, "local-only");
      assert.strictEqual(result.baseBranch, "pivot/other");
    }).pipe(Effect.provide(layer));
  });

  it.effect("launch never reuses a branch taken in git or a leftover worktree directory", () => {
    const { workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const config = yield* ServerConfig.ServerConfig;
      sh(workspaceRoot, "git branch pivot/fix-the-login-bug");
      const first = yield* host.launch(launchInput);
      assert.notStrictEqual(first.branch, "pivot/fix-the-login-bug");
      NodeFS.mkdirSync(first.worktreePath, { recursive: true });
      const second = yield* host.launch(launchInput);
      assert.notStrictEqual(second.branch, first.branch);
      assert.isTrue(second.worktreePath.startsWith(config.worktreesDir));
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "awaitStart, setupOutcome, retryLaunch and relaunch answer what PivotThreads does",
    () => {
      const { fake, layer } = setup();
      return Effect.gen(function* () {
        const host = yield* TeammateHost;
        const threads = yield* PivotThreads.PivotThreads;
        const a = yield* host.launch(launchInput);
        const b = yield* host.launch(launchInput);
        fake.setupOutcomes.set(a.threadId, { status: "failed", detail: "boom" });
        fake.setupOutcomes.set(b.threadId, { status: "failed", detail: "boom" });

        assert.deepStrictEqual(
          yield* host.awaitStart(a.threadId, a.runId!),
          yield* threads.awaitStart(a.threadId, a.runId!),
        );
        assert.deepStrictEqual(
          yield* host.setupOutcome(a.threadId),
          yield* threads.setupOutcome(a.threadId),
        );

        fake.nextRelaunch = { type: "failed", runId: RunId.make("r"), detail: "no" };
        const viaHost = yield* host.retryLaunch(a.threadId);
        fake.nextRelaunch = { type: "failed", runId: RunId.make("r"), detail: "no" };
        assert.deepStrictEqual(viaHost, yield* threads.retryLaunch(b.threadId));

        fake.nextRelaunch = null;
        const text = "Carry on.";
        const hostRun = yield* host.relaunch({
          threadId: a.threadId,
          senderThreadId: pivotThreadId,
          text,
        });
        const directRun = yield* threads.relaunch({
          threadId: b.threadId,
          senderThreadId: pivotThreadId,
          text,
        });
        assert.strictEqual(hostRun.type, directRun.type);
        assert.deepStrictEqual(
          fake.threads.get(a.threadId)!.messages.at(-1),
          fake.threads.get(b.threadId)!.messages.at(-1),
        );
        assert.strictEqual(
          fake.threads.get(a.threadId)!.relaunches,
          fake.threads.get(b.threadId)!.relaunches,
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("send queues, stop stops and discard archives, as PivotThreads does", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const threads = yield* PivotThreads.PivotThreads;
      const a = yield* host.launch(launchInput);
      const b = yield* host.launch(launchInput);

      yield* host.send({ threadId: a.threadId, senderThreadId: pivotThreadId, text: "Hello" });
      yield* threads.send({
        threadId: b.threadId,
        senderThreadId: pivotThreadId,
        text: "Hello",
        mode: "queue",
      });
      yield* host.stop(a.threadId);
      yield* threads.stop(b.threadId);
      yield* host.discard(a.threadId);
      yield* threads.archive(b.threadId);

      const [first, second] = [fake.threads.get(a.threadId)!, fake.threads.get(b.threadId)!];
      assert.deepStrictEqual(first.messages.slice(1), second.messages.slice(1));
      assert.strictEqual(first.messages.at(-1)?.mode, "queue");
      assert.strictEqual(first.stops, second.stops);
      assert.strictEqual(first.archived, second.archived);
      assert.isTrue(first.archived);
    }).pipe(Effect.provide(layer));
  });

  it.effect("pullRequestDetail and mergePullRequest answer what PivotThreads does", () => {
    const { fake, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const threads = yield* PivotThreads.PivotThreads;
      const ref = { projectId, host: "github.com", repository: "acme/app", number: 7 };
      const url = "https://github.com/acme/app/pull/7";
      fake.pullRequests.set(url, { state: "open", headSha: "abc" });

      assert.deepStrictEqual(
        yield* host.pullRequestDetail(ref),
        yield* threads.pullRequestDetail(ref),
      );
      const stale = yield* host
        .mergePullRequest({ ...ref, expectedHeadSha: "old" })
        .pipe(Effect.flip);
      const staleDirect = yield* threads
        .mergePullRequest({ ...ref, expectedHeadSha: "old" })
        .pipe(Effect.flip);
      assert.deepStrictEqual(stale, staleDirect);
      yield* host.mergePullRequest({ ...ref, expectedHeadSha: "abc" });
      assert.deepStrictEqual(fake.merges, [{ url, expectedHeadSha: "abc" }]);
      assert.strictEqual((yield* host.pullRequestDetail(ref)).state, "merged");
    }).pipe(Effect.provide(layer));
  });

  it.effect("landed answers what PivotGit answers, before and after the work lands", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const git = yield* PivotGit.PivotGit;
      const { checkout, worktree } = yield* launched(fake, workspaceRoot);
      const direct = () =>
        git.landed({
          projectRoot: workspaceRoot,
          worktreePath: worktree,
          branch: checkout.branch,
          defaultBranch: "main",
          mergedPullRequestHead: null,
        });
      const through = () =>
        host.landed("land_teammate", { ...checkout, mergedPullRequestHead: null });

      assert.deepStrictEqual(yield* through(), yield* direct());
      NodeFS.writeFileSync(NodePath.join(worktree, "login.ts"), "x\n");
      sh(worktree, "git add -A && git commit -q -m login");
      assert.isFalse((yield* through()).landed);
      sh(workspaceRoot, `git merge -q --ff-only ${checkout.branch}`);
      assert.deepStrictEqual(yield* through(), yield* direct());
      assert.isTrue((yield* through()).landed);
    }).pipe(Effect.provide(layer));
  });

  it.effect("land fast-forwards like PivotGit, and refuses a dirty worktree", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const { checkout, worktree } = yield* launched(fake, workspaceRoot);
      NodeFS.writeFileSync(NodePath.join(worktree, "login.ts"), "x\n");

      const dirty = yield* host.land("land_teammate", checkout);
      assert.deepStrictEqual(dirty, {
        type: "refused",
        reason: "The teammate's worktree has uncommitted changes; it commits them first.",
      });
      assert.isFalse(yield* host.worktreeClean(worktree));

      sh(worktree, "git add -A && git commit -q -m login");
      assert.isTrue(yield* host.worktreeClean(worktree));
      const head = sh(worktree, "git rev-parse HEAD");
      const landed = yield* host.land("land_teammate", checkout);
      assert.deepStrictEqual(landed, { type: "landed", head, defaultBranch: "main" });
      assert.strictEqual(sh(workspaceRoot, "git rev-parse main"), head);
    }).pipe(Effect.provide(layer));
  });

  it.effect("worktreeExists reports what is on disk", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      assert.isTrue(yield* host.worktreeExists(process.cwd()));
      assert.isFalse(yield* host.worktreeExists("/nonexistent/worktree"));
    }).pipe(Effect.provide(layer));
  });

  it.effect("teardown stops the session and processes, removes the worktree, and archives", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const { teammate, checkout, worktree } = yield* launched(fake, workspaceRoot);

      yield* host.teardown("teardown_teammate", {
        ...checkout,
        threadId: teammate.threadId,
        worktreeExists: true,
        force: true,
        branchDisposal: "keep",
      });

      const thread = fake.threads.get(teammate.threadId)!;
      assert.strictEqual(thread.stops, 1);
      assert.isTrue(thread.archived);
      assert.deepStrictEqual(fake.stoppedCheckouts, [worktree]);
      assert.deepStrictEqual(fake.removedWorktrees, [{ worktreePath: worktree, force: true }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("teardown leaves a worktree that is already gone alone", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const { teammate, checkout } = yield* launched(fake, workspaceRoot);
      yield* host.teardown("teardown_teammate", {
        ...checkout,
        threadId: teammate.threadId,
        worktreeExists: false,
        force: false,
        branchDisposal: "keep",
      });
      assert.deepStrictEqual(fake.removedWorktrees, []);
      assert.isTrue(fake.threads.get(teammate.threadId)!.archived);
    }).pipe(Effect.provide(layer));
  });

  it.effect("teardown deletes the teammate's temp files and no other teammate's", () => {
    const { fake, workspaceRoot, layer } = setup();
    const tempRoot = NodeFS.mkdtempSync(NodePath.join(NodeFS.realpathSync("/tmp"), "claude-test-"));
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const { teammate, checkout, worktree } = yield* launched(fake, workspaceRoot);
      const mine = NodePath.join(tempRoot, claudeTempName(worktree));
      const other = NodePath.join(tempRoot, claudeTempName(`${worktree}-other`));
      for (const directory of [mine, other]) {
        NodeFS.mkdirSync(NodePath.join(directory, "session", "tasks"), { recursive: true });
        NodeFS.writeFileSync(NodePath.join(directory, "session", "tasks", "out"), "x");
      }
      yield* host.teardown("teardown_teammate", {
        ...checkout,
        threadId: teammate.threadId,
        worktreeExists: true,
        force: true,
        branchDisposal: "keep",
      });

      assert.isFalse(NodeFS.existsSync(mine));
      assert.isTrue(NodeFS.existsSync(other));
    }).pipe(
      Effect.provideService(ClaudeTempRoot, tempRoot),
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(tempRoot, { recursive: true, force: true }))),
    );
  });

  it.effect("teardown removes the worktree and force-deletes the local branch", () => {
    const { fake, workspaceRoot, layer } = setup();
    return Effect.gen(function* () {
      const host = yield* TeammateHost;
      const { teammate, checkout, worktree } = yield* launched(fake, workspaceRoot);
      sh(workspaceRoot, `git worktree add -q -b ${checkout.branch} ${worktree} main`);

      yield* host.teardown("teardown_teammate", {
        ...checkout,
        threadId: teammate.threadId,
        worktreeExists: true,
        force: false,
        branchDisposal: "force",
      });

      assert.isFalse(NodeFS.existsSync(worktree));
      assert.strictEqual(sh(workspaceRoot, `git branch --list ${checkout.branch}`), "");
    }).pipe(Effect.provide(layer));
  });
});
