# Pivot releases

Synthesized from the 2026-09-29 conversation that followed the managed-processes effort.
`CONTEXT.md` defines the vocabulary. "T3 Pivot" is the name of this fork; "Alpha" is the
upstream T3 Code (Alpha) desktop app installed on the same Mac.

## Problem statement

T3 Pivot has features the Alpha app lacks, but you can't use it as your daily app. There is
no installable build of it, so it only runs as a dev server from the checkout. Nothing
tells you when upstream ships a new release, and nothing brings that release into the fork.
The update button in the sidebar exists in the fork's code, but a local build has no
update feed, so the button is greyed out.

If you did build the fork's desktop app today, it would claim the Alpha app's bundle id,
product name, Electron data folder and update caches. It would install over Alpha. Its
update button, if it worked, would pull Alpha from upstream and replace the fork.

## Solution

T3 Pivot installs as its own Mac app, "T3 Pivot", next to Alpha. It reads the same T3 home
(`~/.t3/userdata`), so every project and thread is in both apps. Only one of them may run at
a time: T3 Pivot refuses to start its server while another live server owns that data, and
says which one.

Two commands on this Mac keep it current:

- `sync` looks for an upstream stable release tag the fork has not merged, and opens a pull
  request on `teoaliano/t3-pivot` that merges it. You review and merge that PR, resolving
  conflicts if there are any.
- `release` builds T3 Pivot from `main`, signs it with your Developer ID, notarizes it, and
  publishes a GitHub release on `teoaliano/t3-pivot`.

The sidebar update button in T3 Pivot checks that repository's releases. When a new one is
published, the button offers it, downloads it and restarts into it, exactly as it does for
Alpha. The mobile app's server controls, which trigger the same desktop update remotely,
follow the same feed.

## User stories

1. As the user, I want T3 Pivot to install as a separate app named "T3 Pivot", so that
   installing it never removes or overwrites Alpha.
2. As the user, I want T3 Pivot and Alpha to show different names in the Dock, the app
   switcher and the menu bar, so that I always know which one I'm in.
3. As the user, I want T3 Pivot to open my existing projects and threads, so that switching
   to it does not mean starting over.
4. As the user, I want T3 Pivot to refuse to start while Alpha's server is running on the
   same data, so that the two can never write to the database at the same time.
5. As the user, I want that refusal to tell me which app is holding the data and what to do,
   so that I can quit it and reopen T3 Pivot without guessing.
6. As the user, I want T3 Pivot to start normally after Alpha crashed and left its runtime
   file behind, so that a stale file never locks me out.
7. As the user, I want T3 Pivot's sidebar update button to check the fork's releases, so
   that it never offers me upstream's build.
8. As the user, I want the update button to download and install a new T3 Pivot release,
   then restart into it, so that updating takes one click.
9. As the user, I want the update button's release links and release notes to open the
   fork's releases page, so that I read what changed in the build I'm about to install.
10. As the user on my phone, I want the server controls to update T3 Pivot on the Mac from
    the fork's feed, so that remote updates behave the same as local ones.
11. As the user, I want one command that tells me whether upstream published a stable
    release the fork hasn't merged, so that I know when there is something to pull in.
12. As the user, I want that command to open a pull request merging the release tag, so
    that I review upstream's changes the same way I review my own.
13. As the user, I want the sync command to do nothing when the fork is already level with
    upstream's newest stable tag, so that I can run it any time.
14. As the user, I want the sync command to reuse an open sync PR instead of opening a
    second one, so that pending merges don't pile up.
15. As the user, I want sync to follow upstream's stable tags and ignore nightly and
    preview tags, so that the fork stays level with what Alpha ships.
16. As the user, I want one command that builds, signs, notarizes and publishes T3 Pivot,
    so that shipping a release doesn't need a checklist.
17. As the user, I want the release command to refuse when `main` has uncommitted changes
    or differs from `origin/main`, so that every release matches a pushed commit.
18. As the user, I want each release to get a version higher than every earlier T3 Pivot
    release, so that the updater always offers the newest one.
19. As the user, I want the version to show which upstream release it is built on, so that
    I can tell at a glance how current the fork is.
20. As the user, I want a new upstream release to always produce a higher T3 Pivot version
    than any fork release built on the previous upstream release, so that merging upstream
    never makes the updater think it is a downgrade.
21. As the user, I want fork release tags that can never collide with upstream's tags, so
    that fetching upstream never clashes with my own tags.
22. As the user, I want the release command to stop before publishing when signing or
    notarization fails, so that I never publish a build macOS will refuse to open.
23. As the user, I want the release command to publish the zip, blockmap and update
    manifest the updater needs, so that the update button works on the very first release.
24. As the user, I want the release command to mark the new release as the latest on
    GitHub, so that the stable update channel finds it.
25. As a maintainer of the fork, I want the fork's identity to live in a few named values,
    so that upstream merges touching the build config conflict in as few places as possible.
26. As a maintainer of the fork, I want upstream's own release workflow to stay unused, so
    that nothing tries to publish to npm, deploy the relay, or deploy app.t3.codes from the
    fork.

## Implementation decisions

**App identity.** T3 Pivot has its own bundle id (`com.teoaliano.t3pivot`), product name
("T3 Pivot"), artifact name, Electron user-data directory and updater cache directory. The
runtime display name drops the stage label ("T3 Pivot", not "T3 Pivot (Alpha)"). A
development run stays distinguishable ("T3 Pivot (Dev)"). There is no legacy user-data
directory to migrate from. These values replace upstream's at the places upstream defines
them, in the desktop build config and the desktop environment. Nothing else in the codebase
learns about the fork.

**Nightly builds.** The fork has no nightly channel. The nightly product name and nightly
branding stay upstream's and are never produced by a fork release.

**Shared T3 home.** T3 Pivot keeps upstream's state-directory resolution, so it reads and
writes `~/.t3/userdata`. The user chose this over a separate copy, knowing Alpha does not
have the guard below: starting Alpha while T3 Pivot runs is still unsafe, and only habit
prevents it.

**Single-server guard.** Before a server records itself in the T3 home's runtime state file,
it reads the file. If the file names another process that is still alive and whose recorded
origin still answers, startup fails with a typed error that carries that process's pid and
origin. A missing file, a dead pid, or an origin that does not answer means the file is
stale, and startup continues and overwrites it. The guard lives in the server's
runtime-state module next to the existing read, write and liveness helpers. The desktop app
shows the error in its existing backend-start failure path, with the text "Another T3 Code
server is already using this data (pid N, origin O). Quit it and reopen T3 Pivot." Both
checks are needed because a pid alone can be reused after a crash.

**URL schemes and renderer origin.** The internal `t3code://app` renderer origin and the
registered `t3code` schemes stay as they are. Changing them ripples through the server's
allowed origins for no gain. External `t3code://` links may open whichever app macOS
picked; that is accepted.

**Update feed.** The build writes an update feed pointing at `teoaliano/t3-pivot` through
the existing publish-config path. The release command sets the repository explicitly; it
does not rely on the git remote. The desktop updater code does not change.

**Release links.** The sidebar button's release history link, the downloaded-update toast
and the release notes link to the fork's releases and to the fork's tag format. One
constant holds the fork's repository for the web client.

**Fork versioning.** A T3 Pivot version is built from the upstream version it is based on:
`MAJOR.MINOR.(PATCH * 100 + n)`, where `n` counts releases on that upstream base starting
at 0. Upstream 0.0.42 gives 0.0.4200, 0.0.4201, and so on. Upstream 0.0.43 then gives
0.0.4300, which sorts above every 0.0.42 build. More than 100 releases on one base is an
error. Plain `X.Y.Z` is required, because the updater's stable channel only reads the
release marked Latest and compares by semver, and the fork's build tooling treats any
suffix as a prerelease. The upstream base is the newest upstream stable tag that is an
ancestor of `main`, not the version in the package files.

**Fork tags.** Fork releases are tagged `pivot-vX.Y.Z` on `origin` only. Upstream's `v*`
tags can be fetched into the same clone without clashing. The updater's stable path reads
the latest release's tag name and downloads assets under it, so the prefix does not affect
it.

**Release planning module.** A new module in `scripts/` holds the decisions as pure
functions. It has no git, network or filesystem access of its own:

- the newest upstream stable tag not yet merged into `main`, given upstream's tags and which
  of them are ancestors of `main`, or nothing
- the next fork version, given the upstream base version and the existing fork tags

**`sync` command.** Fetches upstream and its tags. Asks the planning module for the next
tag. If there is one, it pushes a branch `sync/vX.Y.Z` to `origin` at that tag and opens a
PR into `main`, unless an open PR from that branch already exists. It never merges and never
resolves conflicts. It prints the PR URL or "already level with vX.Y.Z".

**`release` command.** Refuses unless the checkout is on `main`, clean, and equal to
`origin/main`. Asks the planning module for the next version, then builds an arm64 DMG and
zip through the existing desktop artifact build at that version, with the fork's update
repository. It signs with the Developer ID Application identity for team `N2X3SV5FDD` from
the login keychain and notarizes with a stored notarytool keychain profile. It then
verifies the result with `codesign` and `spctl` before publishing anything. It creates the
`pivot-v` tag on `origin` and a GitHub release marked Latest, with the DMG, zip, blockmap
and `latest-mac.yml` attached. Both commands run with the `teoaliano` GitHub account.

**Fork signing mode.** Upstream's signed mac build requires a provisioning profile and
passkey associated-domain entitlements for T3 Connect's Clerk domain. That domain's
association file names upstream's team, so the fork can't use them. The fork adds a signing
mode that signs with the hardened-runtime entitlements the app needs and omits the passkey
entitlements and the provisioning profile. Passkey sign-in to T3 Connect is unavailable in
T3 Pivot. This matches the mobile personal-team build, which drops the same capabilities.

**GitHub Actions stays off** on `teoaliano/t3-pivot`. Upstream's workflows, including the
30-minute release cron, never run. Both commands run on this Mac.

**Mobile is unchanged.** The iOS app is rebuilt by hand after merges (`vp run ios:release`
with the personal-team variables). Its OTA updates are already off.

## Testing decisions

A good test states a behaviour you would notice and says nothing about how the code is
arranged. Assert on what a caller gets back. Do not assert on call counts or on which
helper ran.

Four seams:

- **Desktop build config and branding.** The existing `createBuildConfig` and
  `resolveDesktopAppBranding` functions and the desktop environment's user-data names.
  Tests assert the fork's bundle id, product name, updater cache name and publish repository
  come out of a stable-version build, and the display names for packaged and development
  runs. Prior art: `scripts/build-desktop-artifact.test.ts`,
  `apps/desktop/src/app/DesktopEnvironment.test.ts`.
- **Single-server guard.** The server runtime-state module, with an in-memory filesystem
  and injected liveness and origin probes. Cases: no file, stale file with dead pid, live
  pid whose origin does not answer, live pid whose origin answers (refused, error carries
  pid and origin), and the file naming the current process. Prior art:
  `apps/server/src/serverRuntimeState.test.ts`.
- **Release planning.** Pure functions, table tests. Cases: nightly and preview tags ignored,
  already level, several unmerged tags (newest wins), first release on a base, later
  release on a base, base change resets `n`, the 100-release overflow, suffix versions
  rejected. Prior art: `scripts/resolve-nightly-release.test.ts`,
  `scripts/resolve-previous-release-tag.test.ts`.
- **Update links.** The existing update logic: release history and tag links point at the
  fork's repository and tag format. Prior art:
  `apps/web/src/components/desktopUpdate.logic.test.ts`.

Signing, notarization, publishing and the in-app update are verified once by hand, end to
end: publish release N, install it, publish release N+1, and update to it with the sidebar
button. That pass needs the Developer ID, the notary profile and the network, which no unit
test should have.

## Tasks

1. Build config gives the fork's bundle id, product name, artifact name and updater cache
   name for a stable version. Seam: `createBuildConfig`.
2. Packaged runs are named "T3 Pivot" and development runs "T3 Pivot (Dev)", with the fork's
   user-data directory and no legacy directory. Seam: desktop environment and
   `resolveDesktopAppBranding`.
3. Server startup continues when the runtime state file is missing, names a dead pid, or
   names a live pid whose origin does not answer. Seam: runtime-state module guard.
4. Server startup fails with a typed error carrying pid and origin when a live server owns
   the T3 home, and the desktop app shows the refusal text. Seam: same, plus the desktop
   backend-start failure path.
5. Update button release links, toast and release notes point at the fork's releases and
   `pivot-v` tags. Seam: update logic.
6. Pick the newest unmerged upstream stable tag, ignoring nightly and preview tags. Seam:
   release planning module.
7. Compute the next fork version from the upstream base and existing fork tags, including
   base changes and the overflow error. Seam: same.
8. `sync` command: fetch, plan, push `sync/vX.Y.Z` and open or reuse the PR. Verified by
   hand against the pending upstream tag.
9. Fork signing mode: Developer ID signing and notarization without passkey entitlements
   or a provisioning profile. Seam: `createBuildConfig` for the entitlements it selects;
   the signature itself is checked by hand.
10. `release` command: preflight checks, build at the planned version with the fork feed,
    verify the signature, tag, and publish a Latest release with all updater assets.
    Verified by hand.
11. End-to-end pass: publish two releases and update from the first to the second with the
    sidebar button, then trigger the same update from the phone.
12. Operations doc: a short page in `docs/operations/` on running `sync` and `release` and
    the one-time notary profile setup. No internal doc unless the guard's reasoning needs one.

## Out of scope

- **A separate T3 home for T3 Pivot.** Considered and rejected by the user in favour of
  shared data.
- **Guarding Alpha.** Alpha is upstream's build; only T3 Pivot checks for another server.
- **GitHub Actions releases.** Rejected: it needs Actions on, signing secrets in the repo,
  and upstream's release workflow disabled first.
- **Scheduled sync.** `sync` is run by hand. A routine can call it later.
- **Intel and universal builds.** arm64 only, for this Mac.
- **The `t3` CLI and background service.** `t3 update` and the install scripts still pull
  upstream. T3 Pivot's desktop app is the host.
- **T3 Connect in T3 Pivot.** Passkey sign-in can't work under the fork's team. Remote access
  is Tailscale HTTPS from the desktop app's Connections settings.
- **Upstream web clients.** app.t3.codes connecting to a T3 Pivot server may show a version
  skew warning because the fork's version numbers are larger.
- **Mobile release automation.** The iOS app is rebuilt by hand.

## Further notes

One-time setup the user has to do: create a notarytool keychain profile
(`xcrun notarytool store-credentials`) with an app-specific password or an App Store Connect
API key. The Developer ID Application certificate for `N2X3SV5FDD` is already in the login
keychain.

The first merge will be large: `main` was 230 commits behind upstream `main` on 2026-09-29.
The newest upstream stable tag, `v0.0.42`, is already merged, so `sync` has nothing to do
until upstream tags 0.0.43. A trial merge of upstream `main` hit one conflict, in the
provider runtime instructions.
