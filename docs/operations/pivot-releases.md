# T3 Pivot releases

> For the maintainer of the `teoaliano/t3-pivot` fork. Upstream's own process is in
> [Release](./release.md).

T3 Pivot installs as its own Mac app next to T3 Code (Nightly) and updates itself from the
fork's GitHub releases. The iPhone app updates itself from TestFlight. Every night Homebox
merges upstream into `main` and redeploys, and every morning the release Mac publishes
what `main` hasn't released yet, so the Mac, Homebox and the iPhone run the same build.
GitHub Actions stays off on the fork, so upstream's release workflow never runs.

## One-time setup

- The Developer ID Application certificate for team `N2X3SV5FDD` is in the login keychain.
  Check with `security find-identity -v -p codesigning`.
- Store a notarytool profile named `t3-pivot`:

  ```bash
  xcrun notarytool store-credentials t3-pivot --apple-id <apple-id> --team-id N2X3SV5FDD
  ```

  It prompts for an app-specific password. Releases only use it when the App Store Connect
  key below isn't set up. With the key, notarization works while the Mac is locked, as it
  usually is for the 07:30 run.

- `gh` is logged in as `teoaliano`. It doesn't have to be the active account, because the
  commands pass that account's token to `gh` and `git`.
- The checkout has an `upstream` remote pointing at `pingdotgg/t3code`.
- For TestFlight, team `N2X3SV5FDD` has an App Store Connect app with bundle id
  `com.teoaliano.t3pivot`, and an internal testing group with automatic distribution. An
  App Store Connect API key with the Admin role is saved as
  `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`, and `T3PIVOT_ASC_KEY_ID` and
  `T3PIVOT_ASC_ISSUER_ID` hold its ids. On the phone, TestFlight has Automatic Updates on.

## Pull in an upstream release

```bash
vp run pivot:sync
```

It fetches upstream's tags and looks for the newest nightly tag
(`vX.Y.Z-nightly.YYYYMMDD.BUILD`) that `main` doesn't contain yet. Stable, preview and PR tags
don't count, because the T3 Code app T3 Pivot tracks is Nightly. If it finds one, it pushes a
`sync/<tag>` branch at that tag and opens a PR into `main`, or prints the URL of the PR that's
already open. When `main` is level, it prints `already level with <tag>`. It never merges and
never resolves conflicts: do both on the PR branch.

## Publish a release

```bash
vp run pivot:release
```

Run it from the main checkout on `main`, with no uncommitted changes to tracked files and
level with `origin/main`. Otherwise it refuses. It builds an arm64 DMG and zip, signs and
notarizes them, and checks the zipped app with `codesign`, `stapler` and `spctl`. Then it
publishes a release marked Latest with the DMG, the zip, their blockmaps and `latest-mac.yml`.
If any step fails, nothing is published. Installed copies see the new release from the sidebar
update button.

Versions encode the upstream build they are based on: `MAJOR.MINOR.(PATCH * 100 + n)`, with
`n` counting releases on that base from 0. The base is the `X.Y.Z` of the newest upstream
nightly tag `main` contains, so `0.0.46` nightlies give `0.0.4600`, `0.0.4601`, and so on, and
the first `0.0.47` nightly restarts at `0.0.4700`. After 100 releases on one base the command
refuses until you merge a newer upstream nightly. Release tags are `pivot-vX.Y.Z` and live only on `origin`, so they never
clash with upstream's `v*` tags.

`vp run pivot:ios-release` uploads the iPhone app for the release on `main` to TestFlight,
under the same version. It is the reduced-capability build a personal-team install gets:
no widgets, push, Sign in with Apple or OTA updates.

## Publish every morning from the Mac

The release Mac keeps a dedicated clone at `~/.t3-pivot/app`, never a working checkout, with
an `upstream` remote. From that clone, with the TestFlight ids exported:

```bash
node scripts/pivot.ts nightly-install
```

It writes a launchd agent, `com.teoaliano.t3pivot.nightly`, that runs `pivot.ts nightly` at
07:30 and at every login, so a Mac that was asleep or off catches up when it's next used. It
needs you logged in, because signing reads the login keychain. The agent gets this shell's
`PATH`, with fnm's per-shell directories swapped for the Node that ran the install, and a
UTF-8 locale, which CocoaPods needs.

`nightly` resets the clone to `origin/main`, discarding any local change, so it refuses to run
anywhere but `~/.t3-pivot/app`. It shows a notification when a `sync/<tag>` PR is waiting on
your decision. Then it publishes the desktop release and the TestFlight build `main` doesn't
have yet, and installs the release as `/Applications/T3 Pivot.app`. While T3 Pivot is open it
leaves the app alone, since replacing it would end running turns; the sidebar update button
offers the same release, and the next run installs it if the app is closed. With nothing new
it does nothing. Without the TestFlight ids it skips the iPhone. A failure shows a
notification. The log is `~/Library/Logs/t3-pivot-nightly.log`; run it now with
`launchctl kickstart gui/$(id -u)/com.teoaliano.t3pivot.nightly`, and remove it with
`launchctl bootout gui/$(id -u)/com.teoaliano.t3pivot.nightly`. Rerun `nightly-install`
after the ids or your `PATH` change, since the agent keeps the values it was installed with.

## Run it on a server host

Homebox runs T3 Pivot as a headless server next to its npm `t3` service. They share nothing:
T3 Pivot has its own T3 home (`~/.t3-pivot`), port 3774 and Tailscale HTTPS port 8444, so
T3 Code keeps `https://homebox.<tailnet>.ts.net/` and its own threads. Pair the phone and
the Mac to `https://homebox.<tailnet>.ts.net:8444` as a second environment. A database
T3 Code migrates never touches T3 Pivot here.

The host runs a dedicated clone at `~/.t3-pivot/app`, never a working checkout, with an
`upstream` remote and `gh` logged in as `teoaliano`. Two systemd user units drive it:
`t3-pivot.service` runs `apps/server/dist/bin.mjs serve --base-dir ~/.t3-pivot --port 3774
--tailscale-serve --tailscale-serve-port 8444 --no-browser`, and `t3-pivot-update.timer` runs
`node scripts/pivot.ts host-update` in the clone every night.

`host-update` resets the clone to `origin/main` and merges the newest upstream nightly into it.
A conflict is settled by owner first: in a Pivot-owned file main's side wins, and in vendored
`.repos/` upstream's side wins (see `PIVOT_OWNED_PATHS` and `UPSTREAM_OWNED_PATHS` in
`scripts/pivot.ts`). If conflicts are left, or the merged tree doesn't build, Claude Sonnet 5.5
finishes the merge: it runs headless as `claude -p` in the clone, with every tool and no time
limit, and may change any file, including Pivot code that has to follow an upstream change. It
runs under the host user's Claude Code login, so `t3-pivot-update.service` needs that login (or
`ANTHROPIC_API_KEY`) in its environment. The script commits the merge once no conflict marker
is left and it builds, pushes it to `main` with the agent's summary in the commit message, and
closes any `sync/<tag>` PR it settles.

The agent stops only for a breaking change, upstream or in Pivot, that needs Pivot's design
reworked. Then, or when it fails or leaves a merge that still doesn't build, the merge is
undone, and a `sync/<tag>` PR carries the agent's explanation for you. The host still deploys
`main` without that nightly, and the next nightly is tried again the next night. It rebuilds and
restarts the service whenever `main` moved, which ends any running turn in T3 Pivot. Run it on
demand with `systemctl --user start t3-pivot-update.service` and read the result with
`journalctl --user -u t3-pivot-update`. Changes merged into `main` reach the host on the next
run, and the Mac and iPhone the next morning.

## Things that stay manual

- A `sync/<tag>` PR needs your decision: the agent found a breaking change that needs a
  rework. The Mac's morning run shows a notification while one is open. Nothing from that
  nightly, or later ones, lands until it is settled.
- While T3 Pivot is open on the Mac, a new release waits for its update button.
- Pivot mode's own records live in `~/.t3-pivot/userdata/pivot.sqlite`.
