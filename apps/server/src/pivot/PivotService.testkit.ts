// @effect-diagnostics nodeBuiltinImport:off
/**
 * Pivot service harness for tests: the real service, store, home and git over
 * real temporary repositories, with V2 faked by PivotThreads.testkit.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as PivotDatabase from "./PivotDatabase.ts";
import * as PivotGit from "./PivotGit.ts";
import * as PivotHome from "./PivotHome.ts";
import * as PivotService from "./PivotService.ts";
import * as PivotStore from "./PivotStore.ts";
import * as FakeThreads from "./PivotThreads.testkit.ts";

export const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
export const projectId = ProjectId.make("project-1");

/** Runs a shell command in `cwd` and returns its trimmed stdout. */
export const sh = (cwd: string, command: string) =>
  NodeChildProcess.execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A real repository with one commit on `main`, and optionally an `origin` remote. */
export const makeRepo = (options: { remote?: boolean } = {}) => {
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

/** A real worktree of `repo` on `branch`, where the fake V2 says the teammate works. */
export const addWorktree = (repo: string, worktreePath: string, branch: string, base = "main") => {
  NodeFS.mkdirSync(NodePath.dirname(worktreePath), { recursive: true });
  sh(repo, `git worktree add -q -b ${branch} ${worktreePath} ${base}`);
  return worktreePath;
};

export const harness = (fake: FakeThreads.FakeV2) =>
  PivotService.layer.pipe(
    Layer.provideMerge(PivotStore.layer.pipe(Layer.provide(PivotDatabase.layerMemory))),
    Layer.provideMerge(FakeThreads.layer(fake)),
    Layer.provideMerge(PivotHome.layer),
    Layer.provideMerge(PivotGit.layer),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-pivot-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );

export const setup = (options: { git?: boolean; remote?: boolean } = {}) => {
  const fake = FakeThreads.makeFakeV2();
  const workspaceRoot =
    options.git === false
      ? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pivot-plain-"))
      : makeRepo({ remote: options.remote ?? false });
  fake.projects.set(projectId, { projectId, workspaceRoot, defaultModelSelection: null });
  return { fake, workspaceRoot, layer: harness(fake) };
};
