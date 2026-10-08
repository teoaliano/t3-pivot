import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { nightlyBaseVersion, planForkVersion, planUpstreamSync } from "./pivot-release-plan.ts";

describe("planUpstreamSync", () => {
  const upstreamTags = [
    "v0.0.42",
    "v0.0.46-nightly.20261004.2657",
    "v0.0.46-nightly.20261005.2667",
    "v0.0.46-nightly.20261005.2676",
    "v0.0.46-preview.20261005.2670",
    "v0.0.33-pr.8182.1",
    "nightly-v0.0.21-nightly.20260417.58",
    "desktop-preview",
  ];

  it("follows nightly builds, ignoring stable, preview and pull request tags", () => {
    assert.deepEqual(
      planUpstreamSync({ upstreamTags, mergedTags: ["v0.0.42", "v0.0.46-nightly.20261004.2657"] }),
      Option.some("v0.0.46-nightly.20261005.2676"),
    );
  });

  it("has nothing to sync when main already contains the newest nightly", () => {
    assert.deepEqual(
      planUpstreamSync({ upstreamTags, mergedTags: ["v0.0.46-nightly.20261005.2676"] }),
      Option.none(),
    );
  });

  it("orders nightlies by version, then build", () => {
    assert.deepEqual(
      planUpstreamSync({
        upstreamTags: [
          "v0.0.47-nightly.20261010.2801",
          "v0.0.46-nightly.20261011.2899",
          "v0.0.47-nightly.20261010.2805",
        ],
        mergedTags: [],
      }),
      Option.some("v0.0.47-nightly.20261010.2805"),
    );
  });
});

describe("nightlyBaseVersion", () => {
  it("reads the X.Y.Z a nightly builds toward", () => {
    assert.deepEqual(nightlyBaseVersion("v0.0.46-nightly.20261005.2676"), Option.some("0.0.46"));
    assert.deepEqual(nightlyBaseVersion("v0.0.46"), Option.none());
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
