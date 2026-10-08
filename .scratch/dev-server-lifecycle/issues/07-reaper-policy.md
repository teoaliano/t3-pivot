# Reaper policy: thresholds, sweep, and exemptions

Type: grilling
Status: resolved
Blocked-by: 03

## Question

Given the lease model, decide the reaper's actual numbers and guards.

Reference points in the codebase: `OpenCodeServerOwner` uses a 30-second idle TTL for a
provider server; `ProviderSessionReaper` uses a 30-minute inactivity threshold with a
5-minute sweep. A dev server is expensive to start (install, compile) and cheap to leave
running for a few minutes, which argues for something nearer the latter.

Decide the idle threshold, the sweep interval, the exemptions (an active turn and live
background work at minimum), whether the sweeper gates on
`BackgroundPolicy.shouldRunScopeWork`, whether reaping is announced to the user, and
whether a reaped session auto-restarts when demand returns.

---

## Carried forward from [Port allocation](02-port-allocation.md)

This ticket now owns a **second sweep**: reconciling port reservations against disk,
freeing any whose worktree path no longer exists. Worktrees are removed behind T3's back
(`git worktree remove` from a shell, or removal while T3 is down) and are cycled often, so
without this the range leaks.

Decide whether it shares a cadence and a fiber with the idle reaper or runs separately.
They differ in cost and urgency: reaping stops live processes and wants to be responsive,
while reservation reconcile only frees numbers in a file and could run far less often.

---

## Carried forward from [Lease model](03-lease-model.md)

**A hard constraint on the idle threshold.** Agents auto-start a managed process, finish a
turn, and the process goes idle. If the threshold is shorter than the typical gap between
an agent's turns, every turn pays the startup cost again — for a dev server that means a
full recompile. The threshold must exceed that gap. `OpenCodeServerOwner`'s 30 seconds is
far too short for this; `ProviderSessionReaper`'s 30 minutes is the better starting point,
but pick it against real inter-turn timings rather than by analogy.

**The reaper reads two different signals**, and must honour both:
- *declared* — the scoped borrow refcount (preview subscriptions)
- *inferred* — any thread whose `worktreePath` matches this worktree having
  `activeTurnId != null` or `backgroundLiveness != null`, read off the projection row the
  way `ProviderSessionReaper.ts:78,88` already does

**Exemption:** a pinned process is never reaped. A pinned process that has died on its own
is not restarted.

**Also owns** the reservation reconcile (see the note above), and needs a TTL sweep behind
the borrow refcount, since a leaked increment would otherwise pin a process forever.

---

## Resolution

**Decided 2026-09-21.** Almost entirely a copy of `ProviderSessionReaper`. Reuse-first
throughout; the only genuinely new part is which signals count as demand.

### Structure: copy ProviderSessionReaper

`apps/server/src/provider/Layers/ProviderSessionReaper.ts` is the template, close to line
for line:

- `forkParked(sweep.pipe(Effect.catch(...), Effect.catchDefect(...), Effect.repeat(Schedule.spaced(...))))`
  (`:128-151`), so startup is never blocked and the first sweep runs immediately.
- A cheap timestamp pre-filter (`:58`) before the expensive projection query, so most
  entries cost nothing.
- Each exemption logs why it skipped, at debug level, with the idle duration
  (`:75-93`).
- A stop, then `logInfo` with `{idleDurationMs, reason}`, then a sweep-complete log only
  when something was actually reaped (`:95-126`).
- Failures to stop are logged and **not** counted as reaped (`:110-115`).

### Cadence: 5 minutes

The house ladder is 1 minute for reactors, 5 minutes for the session reaper, 1 hour for
disk work. A managed-process reaper sits where the session reaper sits.

### Threshold: 30 minutes, hardcoded

Same value and same mechanism as `ProviderSessionReaper`
(`DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000`, `:18`), overridable only through the
layer constructor for tests (`:21-37`).

**Not a user setting.** `ProviderSessionReaper` has none. `storageCleanup` is
user-configurable, but its `RetentionControl` is days-granular (`NumberField` 1-3650 plus
a Switch), so minutes would need a new control on top of the 6-8 files a setting costs.
Add one once the default is known to be wrong, not before.

30 minutes also clears the constraint carried from [Lease model](03-lease-model.md): the
threshold must exceed the typical gap between an agent's turns, or every turn pays a full
recompile.

### No BackgroundPolicy gating on the sweep

House convention: reapers and reactors run unconditionally on a fixed cadence; only
demand-driven *pollers* gate on `shouldRunScopeWork`
(`VcsStatusBroadcaster`, `UsageLimitSources`, `makeManagedServerProvider`). We read
`hasDemand` per managed process as an exemption, but the loop itself always runs.

### Exemptions

Copied from `ProviderSessionReaper`:

- a borrowing thread has `activeTurnId != null` (`:75-81`)
- a borrowing thread has `backgroundLiveness != null` (`:86-93`)

Ours, from [Lease model](03-lease-model.md):

- `hasDemand({ type: "managed-process", checkoutPath })` is true — never
  `shouldRunScopeWork`, which would reap on battery
- the process is pinned

### No user notification

Both existing reapers are logs-only. `ProviderSessionReaper` emits
`provider.session.reaped`; `storageCleanup` emits `storage cleanup removed worktree`.
Neither raises a toast or an activity entry.

The one precedent for a visible automatic action is thread auto-settle, which required a
dedicated domain event (`thread.auto-settle`) — ruled out here, since nothing in this
feature is event-sourced.

Visibility comes free from the client wire instead: a reaped process renders as stopped
and startable, which is more useful than a transient toast.

### No auto-restart

The convention is consistent across three subsystems and explicit: never re-arm on a
timer; keep the identity and let the next borrow or command rebuild lazily.
`OpenCodeServerOwner` revives on the next borrow, `storageCleanup` preserves branch and
path so `ProviderCommandReactor` recreates the checkout on the next command, and a reaped
provider session simply starts again on the next turn.

A reaped managed process stays stopped until a human presses start or an agent auto-starts
it, which is what [Lease model](03-lease-model.md) already settled.

### The reservation reconcile runs separately, hourly

Not on the reaper's fiber. It frees numbers in a file for checkouts that no longer exist,
which is disk-shaped bookkeeping and belongs on `storageCleanup`'s 1-hour cadence
(`:449-456`).

Different cost, different urgency: a leaked reservation wastes one block out of 200 and
can wait an hour, while a running dev server should stop promptly once nobody wants it.
Running the cheap job twelve times more often than it needs buys nothing.
