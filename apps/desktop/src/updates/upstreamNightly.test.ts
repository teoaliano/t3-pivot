import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  readUpstreamBaseTag,
  releaseTagsFromAtomFeed,
  resolveUpstreamNightlyNotice,
} from "./upstreamNightly.ts";

// Trimmed from https://github.com/pingdotgg/t3code/releases.atom.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/pingdotgg/t3code/releases</id>
  <link type="text/html" rel="alternate" href="https://github.com/pingdotgg/t3code/releases"/>
  <link type="application/atom+xml" rel="self" href="https://github.com/pingdotgg/t3code/releases.atom"/>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.0.47-preview.20261011.2810</id>
    <link rel="alternate" type="text/html" href="https://github.com/pingdotgg/t3code/releases/tag/v0.0.47-preview.20261011.2810"/>
    <title>T3 Code v0.0.47-preview.20261011.2810</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.0.47-nightly.20261010.2801</id>
    <link rel="alternate" type="text/html" href="https://github.com/pingdotgg/t3code/releases/tag/v0.0.47-nightly.20261010.2801"/>
    <title>T3 Code v0.0.47-nightly.20261010.2801</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.0.46</id>
    <link rel="alternate" type="text/html" href="https://github.com/pingdotgg/t3code/releases/tag/v0.0.46"/>
    <title>T3 Code v0.0.46</title>
  </entry>
</feed>`;

describe("releaseTagsFromAtomFeed", () => {
  it("reads each entry's release tag and skips the feed's own links", () => {
    assert.deepEqual(releaseTagsFromAtomFeed(FEED), [
      "v0.0.47-preview.20261011.2810",
      "v0.0.47-nightly.20261010.2801",
      "v0.0.46",
    ]);
    assert.deepEqual(releaseTagsFromAtomFeed("<html>rate limited</html>"), []);
  });
});

describe("resolveUpstreamNightlyNotice", () => {
  const tags = releaseTagsFromAtomFeed(FEED);

  it("names upstream's newest nightly and this build's base, without the tag prefix", () => {
    assert.deepEqual(
      resolveUpstreamNightlyNotice("v0.0.46-nightly.20261005.2676", tags),
      Option.some({
        latestVersion: "0.0.47-nightly.20261010.2801",
        baseVersion: "0.0.46-nightly.20261005.2676",
      }),
    );
  });

  it("stays quiet when the build is level or the feed lists no newer nightly", () => {
    assert.deepEqual(
      resolveUpstreamNightlyNotice("v0.0.47-nightly.20261010.2801", tags),
      Option.none(),
    );
    assert.deepEqual(
      resolveUpstreamNightlyNotice("v0.0.46-nightly.20261005.2676", ["v0.0.48"]),
      Option.none(),
    );
  });
});

describe("readUpstreamBaseTag", () => {
  it.effect("reads the tag a release embedded and ignores builds without one", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* readUpstreamBaseTag(`{"t3codeUpstreamBaseTag":" v0.0.46-nightly.20261005.2676 "}`),
        Option.some("v0.0.46-nightly.20261005.2676"),
      );
      assert.deepEqual(yield* readUpstreamBaseTag(`{"name":"x"}`), Option.none());
      assert.deepEqual(yield* readUpstreamBaseTag(`{"t3codeUpstreamBaseTag":" "}`), Option.none());
      assert.deepEqual(yield* readUpstreamBaseTag("not json"), Option.none());
    }),
  );
});
