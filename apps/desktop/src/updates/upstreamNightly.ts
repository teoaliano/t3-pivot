// T3 Pivot shares the user's data with T3 Code (Nightly), which updates itself
// and can migrate the database past what this build knows. Each update check
// also compares the upstream nightly this build was released on with
// upstream's newest, so the sidebar can say a T3 Pivot release is due.

import type { DesktopUpstreamNightlyNotice } from "@t3tools/contracts";
import { isNewerNightlyTag, newestNightlyTag } from "@t3tools/shared/nightlyTag";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

/** Upstream's release feed. Its nightly app's updater finds new builds in the same feed. */
export const UPSTREAM_RELEASES_FEED_URL = "https://github.com/pingdotgg/t3code/releases.atom";
const FEED_FETCH_TIMEOUT = Duration.seconds(15);

// Each entry links its release page as `<link ... href=".../releases/tag/<tag>"/>`.
const RELEASE_TAG_HREF = /\/releases\/tag\/([^"/]+)"/g;

/** Release tags listed in a GitHub releases Atom feed. */
export function releaseTagsFromAtomFeed(feed: string): ReadonlyArray<string> {
  return Array.from(feed.matchAll(RELEASE_TAG_HREF), (match) => match[1]!);
}

/** What to tell the user when upstream has a newer nightly than `baseTag`. */
export function resolveUpstreamNightlyNotice(
  baseTag: string,
  upstreamTags: ReadonlyArray<string>,
): Option.Option<DesktopUpstreamNightlyNotice> {
  return newestNightlyTag(upstreamTags).pipe(
    Option.filter((latest) => isNewerNightlyTag(latest, baseTag)),
    Option.map((latest) => ({
      latestVersion: latest.replace(/^v/, ""),
      baseVersion: baseTag.replace(/^v/, ""),
    })),
  );
}

const AppPackageMetadata = Schema.Struct({
  t3codeUpstreamBaseTag: Schema.optional(Schema.String),
});
const decodeAppPackageMetadata = Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata));

/**
 * The upstream tag `pivot release` embedded in the packaged app's package.json.
 * None for dev builds and any build not released by `pivot release`.
 */
export const readUpstreamBaseTag = (rawPackageJson: string) =>
  decodeAppPackageMetadata(rawPackageJson).pipe(
    Effect.map((metadata) =>
      Option.fromNullishOr(metadata.t3codeUpstreamBaseTag?.trim()).pipe(
        Option.filter((tag) => tag.length > 0),
      ),
    ),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/** Upstream's release tags, newest first. */
export const fetchUpstreamReleaseTags = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* httpClient
    .get(UPSTREAM_RELEASES_FEED_URL, {
      headers: { accept: "application/atom+xml, application/xml, text/xml, */*" },
    })
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.map(releaseTagsFromAtomFeed),
      Effect.timeout(FEED_FETCH_TIMEOUT),
    );
});
