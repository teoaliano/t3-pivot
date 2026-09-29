# T3 Pivot releases

> For the maintainer of the `teoaliano/t3-pivot` fork. Upstream's own process is in
> [Release](./release.md).

T3 Pivot installs as its own Mac app next to T3 Code (Alpha) and updates itself from the
fork's GitHub releases. Two commands keep it current, and both run by hand on the release Mac.
GitHub Actions stays off on the fork, so upstream's release workflow never runs.

## One-time setup

- The Developer ID Application certificate for team `N2X3SV5FDD` is in the login keychain.
  Check with `security find-identity -v -p codesigning`.
- Store a notarytool profile named `t3-pivot`:

  ```bash
  xcrun notarytool store-credentials t3-pivot --apple-id <apple-id> --team-id N2X3SV5FDD
  ```

  It prompts for an app-specific password. An App Store Connect API key works too (`--key`,
  `--key-id`, `--issuer`).

- `gh` is logged in as `teoaliano`. It doesn't have to be the active account, because both
  commands pass that account's token to `gh` and `git`.
- The checkout has an `upstream` remote pointing at `pingdotgg/t3code`.

## Pull in an upstream release

```bash
vp run pivot:sync
```

It fetches upstream's tags and looks for a stable `vX.Y.Z` tag that `main` doesn't contain yet.
Nightly, preview and PR tags don't count. If it finds one, it pushes `sync/vX.Y.Z` at that tag
and opens a PR into `main`, or prints the URL of the PR that's already open. When `main` is
level, it prints `already level with vX.Y.Z`. It never merges and never resolves conflicts:
do both on the PR branch.

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

Versions encode the upstream release they are built on: `MAJOR.MINOR.(PATCH * 100 + n)`, with
`n` counting releases on that base from 0. Upstream `0.0.42` gives `0.0.4200`, `0.0.4201`, and
so on, and `0.0.43` restarts at `0.0.4300`. The base is the newest upstream stable tag that
`main` contains. After 100 releases on one base the command refuses until you merge a newer
upstream release. Release tags are `pivot-vX.Y.Z` and live only on `origin`, so they never
clash with upstream's `v*` tags.

## Things that stay manual

- The iOS app is rebuilt by hand after merges (`vp run ios:release` with the personal-team
  variables). Its OTA updates are off.
- T3 Pivot and Alpha share `~/.t3/userdata`. T3 Pivot refuses to start while another live
  server owns that data, but Alpha has no such check. Quit T3 Pivot before opening Alpha.
