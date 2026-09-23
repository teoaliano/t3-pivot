# Map: dev server lifecycle

Label: `wayfinder:map`
Effort: `dev-server-lifecycle`
Charted: 2026-09-21

## Destination

One implementable spec for a **managed script session** in T3 Pivot: a long-running
project script owned by a worktree, with an allocated port, verified attribution, an
explicit start/stop lifecycle, idle reaping, and a preview that binds to the right server.
Reached when every decision below is made and `to-spec` can synthesize without an
interview.

## Notes

**Domain.** T3 Pivot is a fork of T3 Code (`pingdotgg/t3code`) that bakes in firstmate's
(`kunchenguid/firstmate`) crew-supervision model. Reference clones:
`~/.cache/t3-pivot-refs/{t3code,firstmate}`.

**Skills every session should consult:** `grilling` + `domain-modeling` (default),
`codebase-design` for seam/interface questions, and the user's own
`worktree-dev-server` skill, which is the source of the port-attribution rules.

**Companion record.** `docs/findings/dev-server-concurrency.md` holds the findings behind
this effort, including the parked capping decision and six open measurements (§7).

**Where durable decisions go.** Prose under `docs/internals/`, matching T3 Code's own
convention — neither upstream uses ADRs, and `docs/internals/overview.md` states rules
with their reasons in running text. `docs/internals/managed-processes.md` is this
effort's durable write-up; tickets stay the working record and the map stays an index.

### Standing rule: reuse before invention

**Keep as much existing logic from T3 Code and firstmate as possible.** Before designing
anything, find what already does the job and use it. A decision is only worth grilling
over when the logic genuinely does not exist and must change; where it exists, reuse it
and move on. Inventing a parallel mechanism risks overcomplicating and rewriting what does
not need touching.

Practical form: every resolution should name the existing code it reuses, and call out
explicitly anything that is genuinely net-new and why nothing existing would serve.

**Working order: look first, ask second.** Before grilling on a ticket, establish what T3
Code and firstmate already do for it. Only put to the captain what is genuinely left over.
This rule was added after two tickets in a row proposed new mechanisms for problems the
codebase had already solved (a claim register, and a readiness wait).

### Settled at charting

- **One spec**, not two — a start/stop toggle without port attribution still cross-wires.
- **Fork-only governance, upstream-shaped code.** No need for upstream to accept anything,
  but follow T3 conventions so pulling updates stays cheap. Prefer **new files** over
  edits to hot ones (`ChatView.tsx` is 9,000+ lines and `runProjectScript` sits at :4140).
- **Ownership unit is the worktree**, not the thread. The port is a property of the
  checkout. Threads are *borrowers*. (firstmate already enforces 1:1 task↔worktree via
  claimed pool slots, `fm-spawn.sh:131-137`, but this choice does not depend on that.)
- **"Managed script session", not "dev server".** One record; port fields optional. The
  lifecycle half applies to any long-running script, the port half only to servers.
- **Reaping is in scope; capping is not.** Stop what nobody is using. Refusing to start an
  11th server stays parked pending the §7 measurements.
- **Ports reach commands via `{{port}}` placeholders and env vars — never framework
  detection.** T3 must not parse or rewrite a user's shell command. The user writing
  `--strictPort` themselves is what makes "fail rather than slide" enforceable.
- **Agents start servers through the same managed path**, unbounded for now. Known risk,
  named in the spec; the parked effort owns bounding it.
- **Orphans that outlive a killed server are reaped**, following `LocalDeviceHost`.

### Prior art to follow (from charting exploration)

| Pattern | Where | Use for |
|---|---|---|
| Idle TTL + borrow combinator | `OpenCodeServerOwner.ts:11,126-169` | the session owner itself |
| Refcounted scoped `retain` | `PortScanner.ts:56,598-603`; consumer `ws.ts:3492` | preview-open keeps alive |
| Live-work exemptions in a reaper | `ProviderSessionReaper.ts:92,112` | never reap an active turn |
| Cross-restart stale reap (pid + cmdline) | `LocalDeviceHost.ts:269-303` | orphan recovery |
| TTL'd client-activity leases | `BackgroundPolicy.ts:58-77` | demand signal |
| `forkParked` for root fibers | `serverActivation.ts:12-26` | any sweeper |

Conventions: Effect `Context.Service` + `export const layer`; child processes owned by
their own `Scope`; one `Semaphore.make(1)` per state machine; expose a borrow combinator
rather than `start()`/`stop()`; colocated `*.test.ts` with TestClock-driven timing tests.
`AGENTS.md:61` forbids killing by pattern — verify pid liveness *and* command line.

## Decisions so far

<!-- one line per closed ticket -->

- [Session record: durable domain state or runtime service state?](issues/01-session-record-durable-or-runtime.md):
  Nothing event-sourced. Live process in memory, port identity in one global sidecar.
  Called a **managed process**. Durable write-up: `docs/internals/managed-processes.md`.
- [Port allocation: key, block size, and persistence](issues/02-port-allocation.md):
  Blocks of 10 from 11000-12999, keyed on worktree path, reserved not observed, claimed by
  an idempotent `ensureReservation` on use, refused on conflict, stored in one global
  `baseDir` file.
- [Lease model: what keeps a managed process alive](issues/03-lease-model.md):
  Demand is a person looking or an agent working, never client presence. Declared leases
  (preview, scope-tied) plus inferred liveness (live turn / background work, read at
  sweep). Auto-start for agents, explicit for humans. Persisted pin as the only immunity.
  **Amended**: declared leases reuse `BackgroundPolicy` via a new `managed-process` scope
  (TTL, sweep and disconnect cleanup already built) rather than a broker copy, reading
  `hasDemand` and never `shouldRunScopeWork`, which would reap on battery.
- [Attribution and FOREIGN handling](issues/04-attribution-and-foreign.md):
  No working-directory reading on any platform - reservations make cross-wiring
  impossible and cwd is unavailable on Windows. Attribute from our own pid record; name an
  unknown occupant from process name and command line. Check before start and after boot.
  **Never stop a process we did not start, absolutely.** Agents get only the actionable
  minimum.
- [Preview binding: how a tab resolves its server](issues/05-preview-binding.md):
  A **checkout** owns managed processes - `worktreePath ?? project.workspaceRoot`, since
  `local` is the default thread mode (amends the allocation key). Managed process takes
  precedence over t3.json, discovery and history. Wait for readiness before navigating.
  Independent tabs per thread. A stopped process shows as a startable row.
  **Amended**: readiness reuses the scanner's existing HTML-probe gate (do not navigate
  until the port appears in discovery) rather than a new probe loop; the agent path is
  explicitly unchanged.
- [Orphan reaping across restarts and the two unguarded callers](issues/06-orphan-reaping.md):
  **Measured**: pty teardown already kills ordinary dev servers (session-leader SIGHUP);
  only self-detaching or SIGHUP-ignoring children survive. So: managed processes run in
  T3 terminals, no process-group killing, verify the port released instead. Both unguarded
  callers get one extracted `stopAllForCheckout`. Cross-restart record copies
  `reapStaleHub` (pid + command line + port).
- [Reaper policy: thresholds, sweep, and exemptions](issues/07-reaper-policy.md):
  A copy of `ProviderSessionReaper` - 5 minute sweep, 30 minute idle threshold, hardcoded
  with a test-only override, no user setting, no notification, no auto-restart. Exemptions
  are active turn, background liveness, `hasDemand`, and pinned. The reservation reconcile
  runs separately on the hourly disk cadence.
- [Agent surface: MCP tools for managed processes](issues/08-agent-surface.md):
  Exactly one new tool, start. T3 has 21 MCP tools and none runs a command, so this closes
  the only real gap; stop, status and readiness are all already covered. An agent can
  still bypass it with its own shell, accepted.
- [t3.json compatibility for static previewUrl](issues/09-t3json-compatibility.md):
  `previewUrl` unchanged - it is a discovery hint and stops mattering once a checkout has
  a managed process. `autoOpenPreview`, verified dead, gets wired up. No competing JSON
  Schema; fork additions stay optional so files validate both ways.
- [Client wire: how the UI learns about managed processes](issues/10-client-wire.md):
  Copy `WorktreeSetupTracker`'s live stream, keyed on checkout, not its durable activity -
  a checkout-owned process cannot be keyed to one thread's timeline, and a running process
  is always in memory to snapshot. Stopped processes stay in the stream so they render as
  startable. Subscribing holds no lease.
- [Port surface: placeholder syntax and env var names](issues/11-port-surface.md):
  No placeholder syntax at all - T3 has no templating anywhere, and the shell already
  substitutes. `T3CODE_MANAGED_PORT` plus `_1`..`_9` (`T3CODE_PORT` is taken by the
  server's own port), and bare `PORT` is set too so untouched projects work.

## Not yet specified

_Empty._ Every patch either graduated into a resolved ticket or was ruled out of scope
below.

Cleared during the effort:

- **Windows behaviour** — dissolved by
  [Attribution](issues/04-attribution-and-foreign.md), which reads no working directory on
  any platform, removing the capability gap that made Windows a separate problem.
  Discovery is handled by feeding reserved ports to the scanner, and node-pty already
  tears down the process tree there without a POSIX signal.
- **UI placement** — answered in place. `PreviewLocalServerCard` carries the row (and
  currently discards its ownership field), `PreviewEmptyState` hosts the startable row and
  the "Local servers" list, and refusals use a warning toast with an action following the
  "Delete anyway" precedent.
- **Testing strategy** — house convention, not a decision: a colocated `*.test.ts` beside
  each module, with TestClock-driven timing tests as in `OpenCodeServerOwner.test.ts` and
  `PortScanner.test.ts`.

## Out of scope

- **Admission control / capping** — refusing to start a server when resources are tight.
  Parked deliberately in `docs/findings/dev-server-concurrency.md` §4-§5, pending the §7
  measurements. Returns only as a fresh effort.
- **First-mate dispatch awareness** (findings §8). The supervisor should dispatch on
  dependency grounds and let admission control serialize underneath; since capping is out,
  this is too.
- **Remote environments** — a managed process on an SSH or Tailscale-reachable host, with
  a local preview. Moved here from fog rather than graduated: it is a second attribution
  domain and a port-forwarding problem, and it sits past this destination. Two facts bound
  a future effort: the existing URL rewrite swaps the host and **keeps the port**, so
  reservations survive it; and remote previews already fail for anything not loopback or
  private-network, so the limitation is pre-existing rather than introduced here.
- **Mobile previews** — a phone previewing a server bound to a laptop's loopback.
  Inherits whatever remote environments decides, so it returns with that effort.

