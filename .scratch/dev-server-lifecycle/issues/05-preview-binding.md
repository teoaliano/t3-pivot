# Preview binding: how a tab resolves its server

Type: grilling
Status: resolved
Blocked-by: 02

## Question

Q5 settled that opening a preview points at *this worktree's* server rather than a static
`previewUrl`. `PreviewManager` keys sessions by `(threadId, tabId)`; sessions are now owned
by worktrees, so there is a mapping to define.

Decide: how a preview tab resolves its URL from a session record, what happens when the
owning session is not running (offer to start it? show an empty state?
`previewEmptyStateLogic.ts` already exists), what happens when a thread has no worktree,
and what happens when two threads share one worktree and both open previews.

Also decide whether opening a preview takes a lease (ticket 03's concern — flag any
coupling rather than deciding it here).

---

## Carried forward from [Lease model](03-lease-model.md)

**Opening a preview holds a lease, and that lease needs building.** It must follow
`PreviewAutomationBroker.connect` (`:406-416`) — a connection-scoped `acquireRelease`
inside `Stream.unwrap` that unwinds on WS drop. `PreviewManager` itself is unusable as a
demand signal: no TTL, no heartbeat, no connection-scoped finalizer, so a session survives
a browser crash indefinitely and the server only learns of a close via an explicit
`preview.close` RPC.

**Settled: a preview never auto-starts a managed process for a human.** When the owning
process is not running, show an empty state with a start button.
`previewEmptyStateLogic.ts` already exists as the home for that.

---

## Carried forward from [Attribution](04-attribution-and-foreign.md)

Running reserved ports are to be fed into `PortScanner` as **configured candidates**
(`:361-380` already probes those first-class), rather than extending the hardcoded
`COMMON_DEV_PORTS` fallback. Our range sits outside that list, so without this our servers
are invisible to discovery on Windows and anywhere `lsof` is missing. Decide here how that
feed is wired, since it sits between the managed-process registry and the preview surface.

A reserved-but-idle port reads as *free* to the scanner, and only ports returning HTML are
published, so reservations never appear as phantom servers. Preserve that.

---

## Resolution

**Decided 2026-09-21.**

### A checkout owns managed processes, and the project root is a checkout

`local` is the shipped default thread mode, so worktree-less is the common path, not an
edge case. Restricting managed processes to worktrees would leave the most-used
configuration with no stop button and no port safety.

The ownable unit is a **checkout path**: `worktreePath ?? project.workspaceRoot`. A
worktree is one kind, a project root is another, and the reservation key is uniform across
both. This amends [Port allocation](02-port-allocation.md), which had recorded the key as
the worktree path alone.

### URL precedence: managed process first

Order: the checkout's **managed process**, then `t3.json` `previewUrl`, then a discovered
server, then recent history.

If a checkout has a managed process running, that *is* this checkout's server; every other
source is inference. The rest stay available and visible for what the managed process does
not cover — a server started outside T3, or a project that has not adopted managed scripts.

Note this **introduces precedence where none exists**. Today no code picks a URL: the
empty state lists candidates and the user clicks one, with ordering that is purely
cosmetic (`mergeServers`, `PreviewEmptyState`). This is a behaviour change, not a gap
being filled.

### Wait for readiness before navigating

A dev server binds its port seconds before it can answer, and a cold build can be a minute
behind that. Navigating at start gives a connection error that fixes itself on reload,
which reads as a broken app. Worse for agents: one that opens a preview and gets a
connection error will reason about it as a bug in the code under test.

So the preview shows a **starting** state and navigates once the port answers.

**This is new code.** Nothing in the repo waits for an endpoint today — searches for
`waitForServer|waitUntilReady|awaitReady|retryUntil` return nothing outside tests. The
readiness *signal* exists and should be reused rather than reinvented: `probeWebUrl`
(`PortScanner.ts`) already accepts a 2xx with an HTML content type or a redirect, with a
1s timeout. What is missing is a loop around it with a deadline.

`PreviewNavStatus` already carries `Idle | Loading | Success | LoadFailed` with a
`PreviewUnreachable` view, so a failed wait has somewhere to land.

### Two threads in one checkout get independent tabs

`PreviewManager` keys sessions by `(threadId, tabId)` and `open` always mints a new tab, so
independence is the existing grain. Both tabs point at the same managed process and each
holds its own borrow; the process survives until the last one closes.

Nothing in the app keys preview state by worktree today. Browser history is keyed by
*project* (`browserHistoryStore.ts`), so both threads already share a "Recently used" list.

### A stopped managed process appears as a startable row

Required by the lease model: a human never gets implicit start, so there must be something
visible to press.

This **deliberately diverges** from how configured URLs behave. A `t3.json` `previewUrl`
that is not listening vanishes completely — no offline placeholder exists anywhere in the
pipeline (`projectWebProbeSnapshot` only inserts a configured URL when a probe succeeded,
and `mergeServers` iterates only scanner entries). A managed process is different in kind:
it is a named thing with a known owner and a known port, not a string in a config file
that may never have worked. Recording the divergence so it does not later read as an
inconsistency.

### Reserved ports reach discovery server-side

Merged into the scanner from the registry, not passed through the client's
`configuredUrls`. See the amendment on
[Attribution and FOREIGN handling](04-attribution-and-foreign.md).

Preserve the existing behaviour that a reserved-but-idle port reads as free and that only
HTML-returning ports are published, so reservations never appear as phantom servers.

### Remote environments

Out of scope here and still in the map's fog, but two facts bound it. The rewrite in
`resolveDiscoveredServerUrl` swaps the host and **keeps the port**, so reservations survive
it. And remote previews already throw for anything not loopback or private-network
("needs the planned authenticated preview gateway"), so remote is pre-existingly limited
and this work does not worsen it.

---

## Amendment (2026-09-21): readiness reuses the scanner's gate, and the agent path is unchanged

The resolution above said to build a wait loop around `probeWebUrl` with a deadline, and
noted it as the one genuinely net-new behaviour. Under the reuse-before-invention rule it
is not needed.

**`PortScanner` only publishes a port after an HTTP probe returns HTML or a redirect to
HTML.** A port that is bound but still compiling never appears in the discovered list. So
"appears in discovery" already *is* the readiness signal, computed on the existing
3-second poll and already streamed to clients.

**Implementation: after a start, do not navigate until the port appears in discovery.**
Wiring two existing things together. Up to 3 seconds of latency, no new probe code, no
deadline logic of our own.

A zero-code fallback exists if this is ever deferred: after start, the server appears in
the existing "Local servers" list a few seconds later and the user clicks it. The wiring
only saves the second click.

### The agent path gets nothing new, deliberately

Agents already handle this and it works. The pattern today:

1. Run the dev server in a T3 terminal.
2. Read the server's own ready line from the terminal output.
3. Navigate, via `preview_navigate` with `{target:{kind:'environment-port',port}}`.
4. Wait on page conditions with `preview_wait_for`, which takes a `timeoutMs`
   (broker default 15s).

The readiness gap only exists on the **human start-button path**, which is new in this
work. Recording this so nobody later notices that humans get waiting and agents do not,
assumes it was an oversight, and adds agent-side waiting that duplicates a loop the agent
already runs.

Known edge, not worth solving now: `preview_wait_for` does not re-navigate, so if
navigation itself landed on a connection error, waiting for a selector times out rather
than recovering. Agents rarely hit this because step 2 precedes step 3.
