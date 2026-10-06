// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as PivotDatabase from "./PivotDatabase.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotHome from "./PivotHome.ts";
import * as PivotService from "./PivotService.ts";
import * as PivotStore from "./PivotStore.ts";
import * as FakeThreads from "./PivotThreads.testkit.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

const sh = (cwd: string, command: string) =>
  NodeChildProcess.execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A real repository with one commit on `main`, and optionally an `origin` remote. */
const makeRepo = (options: { remote?: boolean } = {}) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pivot-repo-"));
  const work = NodePath.join(root, "work");
  NodeFS.mkdirSync(work);
  sh(work, "git init -q -b main && git config user.email t@t && git config user.name t");
  sh(work, "git config commit.gpgsign false");
  NodeFS.writeFileSync(NodePath.join(work, "README.md"), "hello\n");
  sh(work, "git add -A && git commit -q -m init");
  if (options.remote) {
    const bare = NodePath.join(root, "origin.git");
    sh(root, `git init -q --bare -b main ${bare}`);
    sh(work, `git remote add origin ${bare} && git push -q -u origin main`);
    sh(work, "git remote set-head origin main");
  }
  return work;
};

const harness = (fake: FakeThreads.FakeV2) =>
  PivotService.layer.pipe(
    Layer.provideMerge(PivotStore.layer.pipe(Layer.provide(PivotDatabase.layerMemory))),
    Layer.provideMerge(FakeThreads.layer(fake)),
    Layer.provideMerge(PivotHome.layer),
    Layer.provideMerge(PivotGit.layer),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-pivot-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const projectId = ProjectId.make("project-1");

const setup = (options: { git?: boolean; remote?: boolean } = {}) => {
  const fake = FakeThreads.makeFakeV2();
  const workspaceRoot =
    options.git === false
      ? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pivot-plain-"))
      : makeRepo({ remote: options.remote ?? false });
  fake.projects.set(projectId, { projectId, workspaceRoot, defaultModelSelection: null });
  return { fake, workspaceRoot, layer: harness(fake) };
};

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

  it.effect("a takeover retires the active Pivot", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const pivots = yield* PivotService.PivotService;
      const store = yield* PivotStore.PivotStore;
      const first = yield* pivots.create({ projectId, modelSelection, takeover: false });
      const second = yield* pivots.create({ projectId, modelSelection, takeover: true });
      assert.strictEqual(second.predecessorThreadId, first.threadId);
      assert.isNotNull((yield* store.getPivot(first.threadId))?.retiredAt);
      assert.strictEqual((yield* store.getActivePivot(projectId))?.threadId, second.threadId);
    }).pipe(Effect.provide(layer));
  });
});
