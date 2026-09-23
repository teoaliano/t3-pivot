# Attribution and FOREIGN handling

Type: grilling
Status: resolved
Blocked-by: 02

## Question

The skill's ground truth is process working directory: resolve the pid holding a port,
read its cwd, compare to the worktree root. `MINE` / `FOREIGN` / `free`. `PortScanner`
already extracts a pid per port, so this is an addition to code that already runs.

Decide: when do we attribute (before start, after boot, on every poll, on preview open?),
what does the UI show when a port the session expects is `FOREIGN`, what does an *agent*
see, and what actions are offered.

The skill's own rule is "leave a `FOREIGN` server alone unless the human says otherwise —
it belongs to work you cannot see." Decide whether T3 Pivot adopts that as a hard rule or
offers a guarded takeover. Note `AGENTS.md:61` forbids killing by pattern.

---

## Carried forward from [Port allocation](02-port-allocation.md)

**This ticket is smaller than it looked.** `PortScanner` already maps PIDs to
`{threadId, terminalId}` via `registerTerminalProcesses` (`:595`), and
`TerminalManager.open` already carries `worktreePath` (`:266`). Process↔worktree is
therefore solved; the missing link is only port↔worktree, which reservations now supply.
Check how much of the cwd-walk from the `worktree-dev-server` skill is still needed before
designing it.

**New problem this ticket now owns.** Allocated ports (11000-12999) sit outside
`PortScanner.COMMON_DEV_PORTS`, the curated fallback list used on Windows and whenever
`lsof` is missing (`PortScanner.ts:67,290`). Our servers would be invisible to discovery
on those platforms. Since reservations are known rather than guessed, the fix is to feed
them to the scanner instead of extending a hardcoded list — decide that here.

Also relevant: a reserved-but-idle port reads as *free* to the scanner, and only ports
returning HTML are published, so reservations never pollute discovery. That is the
desired behaviour; confirm it survives whatever is decided here.

---

## Resolution

**Decided 2026-09-21.** This ticket turned out much smaller than charted, because port
reservations remove most of what attribution was for.

### No working-directory reading, on any platform

The `worktree-dev-server` skill resolves a pid from a port and reads its working
directory. That is the right mechanism for an agent with no coordinator. We have two
records it does not: the pid we spawned, and the reservation registry.

Consequences of having them:

- **Cross-wiring between our own servers is structurally impossible.** Every worktree
  holds a distinct block, so two managed processes can never contend for one port. The
  failure the cwd check exists to detect cannot occur among them.
- **Attribution of our own process is a lookup**, not an investigation.

Reading cwd is also not currently possible here. There is not a single `/proc/<pid>/cwd`,
`lsof -d cwd`, or `pwdx` in the repo. `PortScanner`'s header states that
`lsof -iTCP -sTCP:LISTEN -P -n -F pcn` is "the only `lsof` flag set we rely on", so adding
`-d cwd` would deliberately break a stated contract. And Windows exposes no cheap
cross-process cwd API at all: `QueryFullProcessImageNameW` yields the executable path, and
`Win32_Process` does not carry cwd.

A POSIX-only implementation was rejected specifically because it would mean the same
feature answers on macOS and Linux and silently does not on Windows.

An unknown occupant is therefore named **best-effort from `processName`** (already carried
on `DiscoveredLocalServer`) **and `ps -o command=`** (already used by
`LocalDeviceHost.reapStaleHub`). Both work everywhere today.

Note the consistency with `AGENTS.md:61`, which demands a `/proc/<pid>/cwd` check before
killing a process found by matching. We never kill a process we did not start, so we never
need that proof. The rule is also, as it happens, advice to agents rather than an
implemented capability anywhere in this codebase.

### When attribution runs: before start, and after boot

Before start, to answer "is my reserved port free?". After boot, to prove the process that
came up is ours and on the port we asked for — a startup log printing the requested port
states intent, while the running process is evidence, and a framework can ignore
`--strictPort` or bind a different interface.

Not on every scanner poll. Once a process is proven, the thing that changes is it dying,
which the exit watcher already reports.

### Never stop a process we did not start. Absolute.

Not even behind a confirmation prompt. If a reserved port is occupied, we reallocate our
own block and report what we found.

The asymmetry decides it: reallocating costs one restart, while stopping the wrong process
destroys work in a session invisible from here. That gap is too wide to offer as a choice.
"Prove it is a dead worktree of ours and auto-kill" was rejected as the recycled-pid trap.

This does not conflict with orphan reaping, which does kill: there we kill a pid we
recorded spawning and verify it by liveness plus command line, never one we inferred from
a port.

### What an agent is told

The actionable minimum: the port was taken, the block has been reallocated, here is the new
port. Not the occupying pid, its command, or which worktree it belongs to.

An agent cannot act on another worktree's identity, and findings §8 argues fleet-wide
detail should stay out of a supervising agent's context. A human gets the full detail in
the UI, where naming the offending checkout is exactly what makes the message useful.

### Discovery on Windows and where lsof is missing

Our range (11000-12999) sits outside `PortScanner.COMMON_DEV_PORTS`, the curated fallback
probed when `lsof` or `Get-NetTCPConnection` is unavailable, so our servers would be
invisible there. Rather than extending a hardcoded list, **feed running reserved ports in
as configured candidates** — `PortScanner` already probes `configuredUrls` as first-class
candidates (`:361-380`). We know our ports; we should not make the scanner guess them.

Confirmed and retained: a reserved-but-idle port reads as free to the scanner, and only
ports returning HTML are published, so reservations never pollute discovery.

### Known limitation, accepted

`DiscoveredLocalServer.terminal` is unreliable and we must not build on it.
`deriveSubprocessInspectResult` (`Manager.ts:690-716`) returns an empty pid list when a
terminal has no *direct* child, so a dev server that reparents loses its attribution
entirely. We hold the pid ourselves, so this does not affect us.

### Surfacing

Server: a `Schema.TaggedError` with structured fields (port, requested worktree, occupant
name) added to the `PreviewError` union, following `PreviewInvalidUrlError`
(`packages/contracts/src/preview.ts:338-352`), so the client composes copy rather than
parsing a string.

Client: a warning toast with an action, following the "Project is not empty" /
"Delete anyway" precedent at `LegacySidebar.tsx:1550-1570`.

---

## Amendment (2026-09-21), from [Preview binding](05-preview-binding.md)

**Reserved ports must be merged into discovery server-side, not via `configuredUrls`.**

This ticket recorded feeding running reserved ports in as configured candidates. Two facts
rule that channel out:

- The `configuredUrls` set is **fixed for the life of a subscription**
  (`ws.ts:3486-3513`); changing it requires re-subscribing. Reservations change whenever a
  worktree starts a server, so this would churn subscriptions continuously.
- `configuredUrls` originates on the **client**, derived from `t3.json` scripts
  (`previewEmptyStateLogic.ts:7-11` → `ChatView.tsx:2314`). Reservations are server state
  and should never round-trip through a client to reach a server-side scanner.

The server owns both the managed-process registry and the scanner, so it merges reserved
ports directly. Same outcome, no resubscribe, no client involvement.
