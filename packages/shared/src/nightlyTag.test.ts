import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { isNewerNightlyTag, newestNightlyTag, parseNightlyTag } from "./nightlyTag.ts";

describe("nightlyTag", () => {
  it("parses nightly tags and rejects every other upstream tag", () => {
    expect(
      Option.map(parseNightlyTag("v0.0.46-nightly.20261005.2676"), ({ base, build }) => ({
        base,
        build,
      })),
    ).toEqual(Option.some({ base: "0.0.46", build: 2676 }));
    for (const tag of [
      "v0.0.46",
      "v0.0.46-preview.20261005.2670",
      "v0.0.33-pr.8182.1",
      "nightly-v0.0.21-nightly.20260417.58",
      "0.0.46-nightly.20261005.2676",
    ]) {
      expect(parseNightlyTag(tag)).toEqual(Option.none());
    }
  });

  it("orders by version first, then build number, never by date", () => {
    expect(
      newestNightlyTag([
        "v0.0.47-nightly.20261010.2801",
        "v0.0.46-nightly.20261011.2899",
        "v0.0.47-nightly.20261010.2805",
        "v0.0.48-preview.20261012.2900",
      ]),
    ).toEqual(Option.some("v0.0.47-nightly.20261010.2805"));
    expect(newestNightlyTag(["v0.0.46", "desktop-preview"])).toEqual(Option.none());
  });

  it("compares numerically, so 0.0.100 is newer than 0.0.99", () => {
    expect(isNewerNightlyTag("v0.0.100-nightly.20261010.1", "v0.0.99-nightly.20261009.9999")).toBe(
      true,
    );
  });

  it("calls a candidate newer only when both tags are nightlies and it is ahead", () => {
    const base = "v0.0.46-nightly.20261005.2676";
    expect(isNewerNightlyTag("v0.0.46-nightly.20261006.2690", base)).toBe(true);
    expect(isNewerNightlyTag("v0.0.47-nightly.20261010.2700", base)).toBe(true);
    expect(isNewerNightlyTag(base, base)).toBe(false);
    expect(isNewerNightlyTag("v0.0.46-nightly.20261004.2657", base)).toBe(false);
    expect(isNewerNightlyTag("v0.0.47-preview.20261010.2700", base)).toBe(false);
    expect(isNewerNightlyTag("v0.0.47-nightly.20261010.2700", "not-a-tag")).toBe(false);
  });
});
