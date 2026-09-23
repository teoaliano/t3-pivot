# Client wire: how the UI learns about managed processes

Type: grilling
Status: resolved
Blocked-by: —

## Question

Surfaced by [Session record](01-session-record-durable-or-runtime.md): with nothing
event-sourced, managed-process state never reaches the client through the orchestration
snapshot that carries thread and project state. It needs its own wire.

Precedent for exactly this shape: `WorktreeSetupTracker` is memory-only and publishes a
`WorktreeSetupSnapshot` over its own subscription, with the contract noting "the server
keeps this in memory only; a client that reconnects mid-setup gets a fresh snapshot".
`PreviewManager` similarly publishes through `PubSub` rather than the event log.

Decide: snapshot-plus-deltas or snapshot-only-on-change; what a reconnecting client
receives; whether managed-process state is scoped per project, per worktree, or
environment-wide; and what the contract carries (status, port, attribution verdict,
uptime, last error).

**Coupling to [Lease model](03-lease-model.md), which is why this is blocked:** if
subscribing to managed-process state also *holds a lease* — the `PortScanner.retain`
pattern, where `ws.ts:3492` ties a lease to the subscription's scope — then the wire is
demand-bearing and cannot be designed independently of the lease model. Resolve 03 first.

Out of this ticket's scope: the MCP surface agents use, which is
[Agent surface](08-agent-surface.md).

---

## Unblocked by [Lease model](03-lease-model.md)

The coupling is resolved, and the answer is that there is none: **subscribing to
managed-process state does not hold a lease.** Demand comes from preview borrows and from
inferred thread liveness, not from watching status. So this wire can be designed as a
plain read surface.

That makes `WorktreeSetupTracker` the right model to copy wholesale: memory-only state
published as a snapshot over its own subscription, with a reconnecting client simply
getting a fresh snapshot.

---

## Carried forward from [Attribution](04-attribution-and-foreign.md)

**A UI slot already exists and is currently wasted.** `PreviewLocalServerCard` renders each
discovered server as a row with title and description slots and throws `server.terminal`
away. Ownership belongs there.

**Do not build on `DiscoveredLocalServer.terminal`.** It is populated by a process-tree
walk that yields an empty pid list when a terminal has no direct child, so a reparented
dev server loses attribution. Managed-process ownership must come from our own record.

**Refusal surfacing convention**, settled in that ticket and relevant to this wire: a
`Schema.TaggedError` with structured fields on the server, and a warning toast with
`actionProps` on the client, following the "Project is not empty" / "Delete anyway"
precedent at `LegacySidebar.tsx:1550-1570`. The client composes copy from fields; it never
parses a message string.

---

## Carried forward from [Preview binding](05-preview-binding.md)

The wire must carry enough for a **stopped** managed process to render as a startable row:
its name, its checkout, its reserved port, and its status. A process that is not running
still has to be visible and actionable, which is the opposite of how configured URLs
behave today (they vanish when not listening).

It must also carry a **starting/waiting** state distinct from running, since the preview
now waits for readiness before navigating rather than showing a connection error.

---

## Resolution

**Decided 2026-09-22.** Copy `WorktreeSetupTracker`'s live channel. Do not copy its
durable one.

### The pattern being copied

`WorktreeSetupTracker` runs two channels, and `ws.ts:781-785` states why:

> "Live progress keeps streaming from the tracker; this is what a reload or another
> client reads."

1. **Live** — `subscribeWorktreeSetup` streams `tracker.stream(threadId)` through
   `observeRpcStream` (`ws.ts:3205-3210`). Memory-only, ephemeral.
2. **Durable** — one `thread.activity.append` upserted under a fixed id
   (`worktreeSetupActivityId(threadId)`), written at start and again at settle
   (`ws.ts:786-815`).

We take the first and not the second.

### Why not the durable activity

**It cannot be keyed honestly.** A managed process is owned by a *checkout*, and a thread
activity belongs to exactly one thread. Two threads can share a checkout, so there is no
correct answer to whose timeline it lands in. Worktree setup never faces this: a setup
belongs to one thread by construction.

**We do not need it.** The durable half exists because the tracker *drops a finished
setup* once the turn starts, leaving no trace. Our service holds a running process in
memory for as long as it runs, so a reconnecting client always gets a truthful fresh
snapshot, and a stopped process is equally truthful as stopped or absent.

It would also mean writing to the event log, which this feature has ruled out everywhere
else (see [Session record](01-session-record-durable-or-runtime.md)).

The argument against: after a server restart you see nothing where a dev server used to
be. That is correct rather than missing — after a restart there genuinely is no process.

### Shape

An ephemeral subscription over `stream(checkoutPath)`, served with `observeRpcStream`,
mirroring `subscribeWorktreeSetup` exactly but keyed on the checkout rather than a thread.
A reconnecting client gets a fresh snapshot, as the worktree-setup contract already
documents for its own case.

Grain is **per checkout**, matching ownership. An environment-wide view, if ever wanted,
is a separate subscription rather than a widening of this one.

The snapshot must carry enough for every state the UI has to render:

- script name and its checkout
- status, including a **starting** state distinct from running, since the preview now
  waits for readiness before navigating
- the reserved port
- **pinned**, so a pinned process never reads as a leak
- last error, for a process that exited on its own

A **stopped** process must still be present in the stream, because
[Preview binding](05-preview-binding.md) requires it to render as a startable row. This is
deliberately unlike configured URLs, which vanish when nothing is listening.

### Subscribing holds no lease

Settled in [Lease model](03-lease-model.md). Demand comes from preview borrows and from
inferred thread liveness, never from watching status. So this is a plain read surface and
can be designed independently of demand.
