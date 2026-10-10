import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as PivotHome from "./PivotHome.ts";
import { loadPivotText } from "./pivotTexts.ts";

const TestLayer = PivotHome.layer.pipe(
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-pivot-home-" })),
  Layer.provideMerge(NodeServices.layer),
);

const projectId = ProjectId.make("project-1");
const MODELS = "- `research` (default): codex / gpt-5.4. Investigations.";
const withModels = (contract: string) => contract.replace("{{teammateModels}}", MODELS);

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const output = yield* runner.run({ command: "git", args, cwd });
    expect(output.code).toBe(0);
    return output.stdout.trim();
  });

const read = (home: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.join(home, name));
  });

it.layer(TestLayer)("PivotHome", (it) => {
  it.effect(
    "creates a clean repository holding the contract, CLAUDE.md and empty preferences",
    () =>
      Effect.gen(function* () {
        const pivotHome = yield* PivotHome.PivotHome;
        const config = yield* ServerConfig.ServerConfig;
        const path = yield* Path.Path;

        const home = yield* pivotHome.ensure(projectId, MODELS);

        expect(home).toBe(path.join(config.stateDir, "pivot-homes", projectId));
        expect(yield* read(home, "AGENTS.md")).toBe(withModels(yield* loadPivotText("AGENTS")));
        expect(yield* read(home, "CLAUDE.md")).toBe("@AGENTS.md\n");
        expect(yield* read(home, "preferences.md")).toBe("");
        expect(yield* git(home, "status", "--porcelain")).toBe("");
        expect(yield* git(home, "rev-list", "--count", "HEAD")).toBe("1");
        expect(yield* git(home, "ls-files")).toBe("AGENTS.md\nCLAUDE.md\npreferences.md");
      }),
  );

  it.effect("is idempotent", () =>
    Effect.gen(function* () {
      const pivotHome = yield* PivotHome.PivotHome;
      const first = yield* pivotHome.ensure(projectId, MODELS);
      const head = yield* git(first, "rev-parse", "HEAD");

      const second = yield* pivotHome.ensure(projectId, MODELS);

      expect(second).toBe(first);
      expect(yield* git(second, "rev-parse", "HEAD")).toBe(head);
      expect(yield* git(second, "status", "--porcelain")).toBe("");
    }),
  );

  it.effect("gives each project its own home", () =>
    Effect.gen(function* () {
      const pivotHome = yield* PivotHome.PivotHome;
      const a = yield* pivotHome.ensure(ProjectId.make("project-a"), "");
      const b = yield* pivotHome.ensure(ProjectId.make("project-b"), "");
      expect(a).not.toBe(b);
    }),
  );

  it.effect("rewrites a stale contract, keeps preferences, and leaves the tree clean", () =>
    Effect.gen(function* () {
      const pivotHome = yield* PivotHome.PivotHome;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* pivotHome.ensure(projectId, MODELS);

      // An older release's contract, committed, plus rules the user wrote themselves.
      yield* fs.writeFileString(path.join(home, "AGENTS.md"), "# Old contract\n");
      yield* fs.writeFileString(path.join(home, "preferences.md"), "Always answer in French.\n");
      yield* git(home, "add", "-A");
      yield* git(home, "commit", "-m", "older release");

      yield* pivotHome.ensure(projectId, MODELS);

      expect(yield* read(home, "AGENTS.md")).toBe(withModels(yield* loadPivotText("AGENTS")));
      expect(yield* read(home, "preferences.md")).toBe("Always answer in French.\n");
      expect(yield* git(home, "status", "--porcelain")).toBe("");
    }),
  );

  it.effect("keeps uncommitted user edits to preferences untouched", () =>
    Effect.gen(function* () {
      const pivotHome = yield* PivotHome.PivotHome;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* pivotHome.ensure(projectId, MODELS);

      yield* fs.writeFileString(path.join(home, "preferences.md"), "Never merge on Fridays.\n");
      yield* fs.writeFileString(path.join(home, "AGENTS.md"), "# Edited by hand\n");

      yield* pivotHome.ensure(projectId, MODELS);

      expect(yield* read(home, "AGENTS.md")).toBe(withModels(yield* loadPivotText("AGENTS")));
      expect(yield* read(home, "preferences.md")).toBe("Never merge on Fridays.\n");
      expect(yield* git(home, "status", "--porcelain")).toBe("");
    }),
  );

  it.effect("shipped contract stays under 3,000 words", () =>
    Effect.gen(function* () {
      const contract = yield* loadPivotText("AGENTS");
      const words = contract.split(/\s+/).filter((word) => word.length > 0);
      expect(words.length).toBeLessThan(3000);
    }),
  );
});
