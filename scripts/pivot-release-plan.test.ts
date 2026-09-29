import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { planForkVersion, planUpstreamSync } from "./pivot-release-plan.ts";

describe("planUpstreamSync", () => {
  const upstreamTags = [
    "v0.0.41",
    "v0.0.42",
    "v0.0.43-nightly.20260929.2428",
    "v0.0.43-preview.20260928.2413",
    "v0.0.33-pr.8182.1",
    "nightly-v0.0.21-nightly.20260417.58",
    "desktop-preview",
  ];

  it("ignores nightly, preview and pull request tags", () => {
    assert.deepEqual(
      planUpstreamSync({ upstreamTags, mergedTags: ["v0.0.41"] }),
      Option.some("v0.0.42"),
    );
  });

  it("has nothing to sync when main already contains the newest stable tag", () => {
    assert.deepEqual(
      planUpstreamSync({ upstreamTags, mergedTags: ["v0.0.41", "v0.0.42"] }),
      Option.none(),
    );
  });

  it("picks the newest stable tag when several are unmerged", () => {
    assert.deepEqual(
      planUpstreamSync({
        upstreamTags: ["v0.0.9", "v0.0.43", "v0.0.10", "v0.1.0", "v0.0.44"],
        mergedTags: ["v0.0.9"],
      }),
      Option.some("v0.1.0"),
    );
  });
});

describe("planForkVersion", () => {
  it.effect("starts a new upstream base at release zero", () =>
    Effect.gen(function* () {
      assert.equal(yield* planForkVersion({ upstreamBase: "0.0.42", forkTags: [] }), "0.0.4200");
    }),
  );

  it.effect("counts up from the newest release on the same base", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* planForkVersion({
          upstreamBase: "0.0.42",
          forkTags: ["pivot-v0.0.4200", "pivot-v0.0.4201", "v0.0.42", "sync/v0.0.42"],
        }),
        "0.0.4202",
      );
    }),
  );

  it.effect("resets the count when upstream moves, so the new base sorts above the old", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* planForkVersion({
          upstreamBase: "0.0.43",
          forkTags: ["pivot-v0.0.4200", "pivot-v0.0.4201", "pivot-v0.0.4202"],
        }),
        "0.0.4300",
      );
      assert.equal(
        yield* planForkVersion({ upstreamBase: "0.1.0", forkTags: ["pivot-v0.0.4302"] }),
        "0.1.0",
      );
    }),
  );

  it.effect("refuses a hundred and first release on one base", () =>
    Effect.gen(function* () {
      const error = yield* planForkVersion({
        upstreamBase: "0.0.42",
        forkTags: ["pivot-v0.0.4299"],
      }).pipe(Effect.flip);

      assert.equal(
        error.message,
        "T3 Pivot already has 100 releases on upstream 0.0.42. Merge a newer upstream release first.",
      );
    }),
  );

  it.effect("rejects an upstream base that is not plain X.Y.Z", () =>
    Effect.gen(function* () {
      const error = yield* planForkVersion({
        upstreamBase: "0.0.43-nightly.20260929.2428",
        forkTags: [],
      }).pipe(Effect.flip);

      assert.equal(
        error.message,
        "Upstream base '0.0.43-nightly.20260929.2428' is not a plain X.Y.Z version.",
      );
    }),
  );
});
