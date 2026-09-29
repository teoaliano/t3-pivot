// Release decisions for T3 Pivot, the fork of T3 Code. Pure functions over tag
// names: the `pivot` command gathers tags from git and acts on the result.

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Fork releases are tagged `pivot-vX.Y.Z`, which never collides with upstream's `v*`. */
export const FORK_TAG_PREFIX = "pivot-v";

// Each upstream base leaves room for this many fork releases in its patch digits.
const RELEASES_PER_BASE = 100;

export class ForkVersionError extends Schema.TaggedError<ForkVersionError>()("ForkVersionError", {
  reason: Schema.Literals(["base-not-stable", "base-exhausted"]),
  upstreamBase: Schema.String,
}) {
  override get message(): string {
    return this.reason === "base-not-stable"
      ? `Upstream base '${this.upstreamBase}' is not a plain X.Y.Z version.`
      : `T3 Pivot already has ${RELEASES_PER_BASE} releases on upstream ${this.upstreamBase}. Merge a newer upstream release first.`;
  }
}

interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseStableVersion(version: string): Option.Option<StableVersion> {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (!match) return Option.none();
  return Option.some({ major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) });
}

function compareStableVersions(left: StableVersion, right: StableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** The newest upstream stable tag (`vX.Y.Z`), ignoring nightly, preview and PR tags. */
export function newestStableTag(tags: ReadonlyArray<string>): Option.Option<string> {
  let newest: { readonly tag: string; readonly version: StableVersion } | undefined;
  for (const tag of tags) {
    if (!tag.startsWith("v")) continue;
    const version = parseStableVersion(tag.slice(1));
    if (Option.isNone(version)) continue;
    if (!newest || compareStableVersions(version.value, newest.version) > 0) {
      newest = { tag, version: version.value };
    }
  }
  return Option.fromNullishOr(newest?.tag);
}

/**
 * The upstream stable tag `sync` should merge into `main`, given every upstream
 * tag and the ones already reachable from `main`. None when `main` is level.
 */
export function planUpstreamSync(input: {
  readonly upstreamTags: ReadonlyArray<string>;
  readonly mergedTags: ReadonlyArray<string>;
}): Option.Option<string> {
  return newestStableTag(input.upstreamTags).pipe(
    Option.filter((tag) => !input.mergedTags.includes(tag)),
  );
}

/**
 * The next T3 Pivot version: `MAJOR.MINOR.(PATCH * 100 + n)`, where `n` counts
 * releases on the upstream base from 0. A newer upstream base always sorts
 * above every release on an older one, so the updater never sees a downgrade.
 */
export const planForkVersion = (input: {
  readonly upstreamBase: string;
  readonly forkTags: ReadonlyArray<string>;
}) =>
  Effect.gen(function* () {
    const base = parseStableVersion(input.upstreamBase);
    if (Option.isNone(base)) {
      return yield* new ForkVersionError({
        reason: "base-not-stable",
        upstreamBase: input.upstreamBase,
      });
    }
    const { major, minor, patch } = base.value;
    const firstPatch = patch * RELEASES_PER_BASE;
    let next = 0;
    for (const tag of input.forkTags) {
      if (!tag.startsWith(FORK_TAG_PREFIX)) continue;
      const released = parseStableVersion(tag.slice(FORK_TAG_PREFIX.length));
      if (Option.isNone(released)) continue;
      const { major: releasedMajor, minor: releasedMinor, patch: releasedPatch } = released.value;
      const n = releasedPatch - firstPatch;
      if (releasedMajor === major && releasedMinor === minor && n >= 0 && n < RELEASES_PER_BASE) {
        next = Math.max(next, n + 1);
      }
    }
    if (next >= RELEASES_PER_BASE) {
      return yield* new ForkVersionError({
        reason: "base-exhausted",
        upstreamBase: input.upstreamBase,
      });
    }
    return `${major}.${minor}.${firstPatch + next}`;
  });
