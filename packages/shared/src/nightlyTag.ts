/**
 * Upstream T3 Code tags its nightly builds `vX.Y.Z-nightly.YYYYMMDD.BUILD`.
 * T3 Pivot tracks that channel: the `pivot` scripts pick the nightly to merge
 * and release from these tags, and the desktop app compares the one it was
 * built on with upstream's newest.
 */
import * as Option from "effect/Option";

const NIGHTLY_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/;

export interface NightlyTag {
  readonly tag: string;
  /** The `X.Y.Z` the nightly builds toward. */
  readonly base: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly build: number;
}

/** None for stable, preview and pull request tags. */
export function parseNightlyTag(tag: string): Option.Option<NightlyTag> {
  const match = NIGHTLY_TAG_PATTERN.exec(tag);
  if (!match) return Option.none();
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return Option.some({
    tag,
    base: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    build: Number(match[5]),
  });
}

/** Orders nightlies by `X.Y.Z`, then build number. */
export function compareNightlyTags(left: NightlyTag, right: NightlyTag): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch ||
    left.build - right.build
  );
}

/** The newest nightly tag, ignoring stable, preview and pull request tags. */
export function newestNightlyTag(tags: ReadonlyArray<string>): Option.Option<string> {
  let newest: NightlyTag | undefined;
  for (const tag of tags) {
    const nightly = parseNightlyTag(tag);
    if (Option.isSome(nightly) && (!newest || compareNightlyTags(nightly.value, newest) > 0)) {
      newest = nightly.value;
    }
  }
  return Option.fromNullishOr(newest?.tag);
}

/** True only when both are nightly tags and `candidate` is the newer build. */
export function isNewerNightlyTag(candidate: string, base: string): boolean {
  const left = parseNightlyTag(candidate);
  const right = parseNightlyTag(base);
  return (
    Option.isSome(left) && Option.isSome(right) && compareNightlyTags(left.value, right.value) > 0
  );
}
