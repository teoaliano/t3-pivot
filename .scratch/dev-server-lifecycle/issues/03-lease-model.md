# Lease model: what keeps a managed process alive

Type: grilling
Status: resolved
Blocked-by: 01

## Question

Q8 settled that a session can stop itself when nobody is using it. This ticket decides
what "using" means.

Candidate demand signals, all with existing implementations:
- an open preview subscription (`PortScanner.retain` tied to a `Stream.callback` scope,
  `ws.ts:3492`)
- a live turn in a borrowing thread (`ProviderSessionReaper` reads `activeTurnId` and
  `backgroundLiveness`)
- a TTL'd client-activity lease (`BackgroundPolicy`, 45s default / 120s max)
- an explicit user "pin" that opts out of reaping entirely

Decide which of these hold a lease, whether the API is a borrow combinator
(`withSession(use)`, as `OpenCodeServerOwner` does) or an explicit acquire/release, and
whether a session with zero borrowers dies or merely becomes reapable.

---

## Resolution

**Decided 2026-09-21.**

### Demand is a person looking, or an agent working. Never client presence.

Client-activity leases (`BackgroundPolicy`) were rejected outright. With no client
connected, `activeScopeKeys` is empty and every demand-gated background task stops. For a
fork whose premise is agents working unattended, a lease keyed on client presence means a
headless agent's dev server is never kept alive — the exact opposite of what is needed.

### Two kinds of demand

**Declared** — a scoped `borrow(worktree, script)` that refcounts and releases when its
scope closes. Held by preview subscriptions.

It must be built on `PreviewAutomationBroker.connect`'s connection-scoped
`Effect.acquireRelease` inside `Stream.unwrap` (`:406-416`), **not** on `PreviewManager`.
Manager sessions have no TTL, no heartbeat, and no connection-scoped finalizer: they
survive a WS drop, a browser crash, and machine sleep indefinitely, and the server only
learns a tab closed if the client sends an explicit `preview.close`. As a lease that would
never release. This is new plumbing, not a signal readable today.

A TTL sweep sits behind the refcount regardless. `PortScanner.retain` has no such backstop
and a single leaked increment pins it forever.

**Inferred** — read at sweep time, never declared: does any thread whose `worktreePath` is
this worktree have `activeTurnId != null` or `backgroundLiveness != null`? This is the
`ProviderSessionReaper` pattern (`:78,:88`), reading fields already denormalised onto the
thread projection row and already consulted by three independent reapers.

The agent case therefore needs **no lease plumbing at all**, only a query. It also survives
headless operation: no client, no preview, no subscription, but a live turn still protects
the process.

`backgroundLiveness` counts as demand in **both** its states, so a thread running a watch
loop or tailing logs keeps its server up. A "borrowing thread" is any thread whose
`worktreePath` matches the worktree.

### Starting: auto for agents, explicit for humans

An agent needing to verify something in a browser must be able to start a server itself;
waiting for a human to click defeats the fleet model, and an agent inside a turn is
precisely the caller for whom a multi-minute compile is acceptable. A human gets no
implicit start: a preview with no server shows an empty state and a start button
(`previewEmptyStateLogic.ts` already exists for this).

**Constraint this places on [Reaper policy](07-reaper-policy.md):** an agent auto-starts,
finishes its turn, the process goes idle and is reaped, and the next turn pays the startup
cost again. The idle threshold must exceed the typical gap between turns or agents will
recompile constantly.

**Known and accepted:** agent auto-start is uncapped. That is the capping problem parked in
`docs/findings/dev-server-concurrency.md`, now reachable with no human in the loop.

### API shape

Not a `withServer`-style combinator as the primary API. That shape requires the process to
die with the caller's scope, and three of the four entry points outlive any single scope.

- `ensureRunning(worktree, script)` — idempotent; serves both human explicit start and
  agent auto-start.
- `borrow(worktree, script)` — scoped, refcounted, releases on scope close.
- `stop(worktree, script)` — explicit.
- `setPin(worktree, script, pinned)` — persisted user intent.

### Pin

Explicit start confers **no immunity**. Otherwise idle shutdown would never fire in the
common case, since most processes are started explicitly.

The opt-out is a persisted pin, modelled on `settledOverride`
(`packages/contracts/src/orchestration.ts:794`) — a user-set override that removes a
resource from an automatic lifecycle policy. It lives in the same global `baseDir` sidecar
as port reservations, keyed on `(worktreePath, scriptId)`: same key domain, and it is user
intent, which the tier rule already puts on disk. A pin must be visible in the UI so a
pinned process never reads as a leak.

### Death and reaping

When the last lease drops a process becomes **reapable, not dead**. The countdown belongs
to [Reaper policy](07-reaper-policy.md). `OpenCodeServerOwner` already validates the
shape: refcount plus a 30-second linger, re-checked under a mutex after the sleep.

A **pinned process that dies on its own stays dead**, surfaced as "pinned, stopped". No
restart policy. A dev server usually exits because the code does not compile, and
restart-looping produces noise rather than progress. `LocalDeviceHost.superviseHub`
restarts a hub whose failure is genuinely transient; a user's dev server is not that.

---

## Amendment (2026-09-21): declared leases use BackgroundPolicy, not a broker copy

Raised by the reuse-before-invention rule added to the map's Notes. The original
resolution said to copy `PreviewAutomationBroker`'s connection-scoped pattern and add our
own TTL sweep behind it. That sweep is precisely what `BackgroundPolicy` already is.

**Decision: add a `{ type: "managed-process", checkoutPath }` variant to `BackgroundScope`
and use the existing machinery.**

What that buys, already written and in daily use:

- TTL expiry. Reports are valid 45s by default, clients re-report every 25s.
- A 15s sweep dropping expired leases.
- Immediate removal of a client's leases when its connection closes
  (`ws.ts:629-642` finalizer).
- Client-side reporting, including `EnvironmentRpcSubscriptionObserver` deriving scopes
  from RPC subscriptions automatically.

The failure the broker copy could not survive is a release step that never runs: the claim
would persist forever and the process could never be stopped without restarting T3. With
`BackgroundPolicy` the lease expires regardless.

### Use `hasDemand`, never `shouldRunScopeWork`

**Verified by reading the source, not inferred.**

- `hasDemand` (`BackgroundPolicy.ts:289-290`) is
  `current.activeScopeKeys.includes(scopeKey(scope))`. Pure presence.
- `activeScopeKeys` (`:188-196`) is built only from leases passing
  `isLeaseActive(lease, now)`, which is `DateTime.isGreaterThan(lease.expiresAt, now)`
  (`:78`). So expiry is real and `hasDemand` respects it.
- `shouldRunScopeWork` (`:292-301`) returns false when `isHostConstrained` — suspended,
  locked, thermally stressed, low power mode, or **on battery** — and outside the
  `performance` profile additionally requires the lease be foreground
  (visible and focused or recently interacted).

Using `shouldRunScopeWork` would stop a running dev server when the laptop is unplugged or
the window loses focus. That is wrong for a managed process and is the single trap on this
path.

Accepted risk: `hasDemand` has **no production callers today**, only tests. We would be
its first real consumer. The behaviour was read directly and matches what is needed.

### Cost

Four additive edits to closed sets, each compiler-checked so none can be missed:

1. `packages/contracts/src/background.ts:48` — the `BackgroundScope` union
2. `apps/server/src/background/BackgroundPolicy.ts:62-75` — `scopeKey`
3. `apps/web/src/lib/backgroundActivityReporter.ts:49-62` — `stableScopeKey`
4. `apps/mobile/src/connection/background-activity-scopes.ts:24-36` — `stableScopeKey`

Plus `scopeForSubscription` in the web and mobile reporters if the scope should be
retained automatically by the preview subscription.

No existing behaviour changes: this extends a list, it does not alter shared logic. The
one genuine coupling is that TTL and sweep cadence are shared, so they cannot be tuned for
managed processes alone.

### Reversibility

Cheap in both directions. Everything downstream asks one question — is there demand for
this checkout — so swapping the answer's source is local.
