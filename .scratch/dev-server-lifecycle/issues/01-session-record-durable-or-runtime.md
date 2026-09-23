# Session record: durable domain state or runtime service state?

Type: grilling
Status: resolved
Blocked-by: —

## Question

Where does a managed script session live? T3 Code has two established homes and they
imply very different things.

**Durable domain state** — commands, events, a projector, SQLite projections. Survives
restart, replays, subject to `decider`/`projector` conventions and schema-compatibility
rules for old environments.

**Runtime service state** — an in-memory Effect service, scope-owned, empty after restart.
`OpenCodeServerOwner` and `ThreadBackgroundLiveness` both take this route;
`ThreadBackgroundLiveness` is explicit that after a restart "orphaned background work is
not live."

A running process cannot be replayed, which argues for runtime state — but Q10 settled
that we persist `{pid, port, worktreePath}` for cross-restart orphan reaping, which is a
sidecar state file, not the event log. Decide the split precisely: what is in the service,
what is on disk, and what (if anything) reaches the event log.

Also decide what the record's fields are, since everything downstream keys off it.

---

## Resolution

**Decided 2026-09-21.** Nothing is event-sourced. State splits across two tiers.

### Naming

The thing is a **managed process**, not a "session". T3 Code's glossary already defines
Session as "the provider runtime attached to a thread", and the codebase carries
`ProviderSessionReaper`, `McpSessionRegistry`, and `thread.session.stop`. A second meaning
would be ambiguous in review and in the spec. "Dev server" stays as informal UI copy where
the managed process is in fact a server.

### Tier 1 — memory (Effect service, scope-owned)

The live child process and everything describing it: its `Scope`, borrower refcount,
current status, output wiring, exit watcher.

Follows the codebase's stated rule — *state describing a live process or a live client view
is memory-only; state describing bytes on disk or user intent is durable* — and matches
`TerminalManager` (live sessions are a memory-only `Map`; the layer finalizer kills every
PTY with escalation, and there is no reattach path), `OpenCodeServerOwner`,
`WorktreeSetupTracker`, and `ThreadBackgroundLiveness`.

### Tier 2 — one global sidecar file

Port reservations plus `{pid, port, worktreePath, command}` for orphan reaping.
**One global file**, not per-worktree: allocation needs a global view to guarantee
non-collision, and a single atomically-written file gives that without reading N files or
racing while doing so. Precedent: `server-runtime.json` (global, atomic via
`writeFileStringAtomically`, and self-versioned with `version: Schema.Literal(1)`).

Sidecars are an established third tier here — atomic, self-versioned, self-reaping, zero
migration ceremony — and `LocalDeviceHost`'s rationale is nearly this use case verbatim:
"so a server that dies without running its finalizers (SIGKILL, dev-runner restarts) does
not leave a hub bound to a loopback port forever."

### Tier 3 — event log: nothing

A new persisted entity touches ~15-20 files including the three largest in the server
(`ProjectionSnapshotQuery.ts` 3,795 lines, `ProjectionPipeline.ts` 2,207, `decider.ts`
2,206) plus a migration registered twice by hand. There is **no event schema version
field**; compatibility is "never break the struct", enforced by decode failure at startup,
and the docs' precedent for legacy fields is "this feature does not schedule their
removal". Adding an event is permanent. That is a bad trade for state whose entire subject
is a process that dies, and it lands on exactly the files upstream churns most — directly
against the fork's stay-mergeable posture.

Counter-example that priced this: provider sessions *are* projected into SQLite, and pay
for it with a startup orphan sweep and a user-facing error that exists only because of the
choice — `"Provider session did not survive a server restart. Send a new message to
continue."`

### Restart semantics

**Process lifetime is ephemeral; port identity is durable.** A T3 restart kills managed
processes and frees their ports, but the worktree keeps its reservation and re-binds the
same port next start. Reattaching to a surviving process was rejected: it means
reconstructing scope ownership, output streams, and exit watchers for a process T3 did not
spawn, and the provider-session precedent shows the ongoing tax.

### Grain

The **record** is per `(worktree, script)`. The **reservation** is a block of ports per
worktree, which every record in that worktree draws from. Different grains on purpose: the
block guarantees no two worktrees can collide regardless of how many scripts each runs,
while the per-script record keeps stop/start/reap operating on the single thing the user
clicked.

### Lifetime against threads

A managed process **survives deletion of every thread that borrows it**. The worktree owns
it; threads only borrow. Deleting a thread releases a borrow — it never terminates the
process — after which the reaper stops it if nothing else holds a lease.

### Carried forward

The "stolen port" scenario — W1 reserves 3000, stops its server, W2 starts and takes 3000,
W1 returns — is resolved by allocating through **reservation, not observation**: a registry
knows what is *claimed*, while `lsof` only knows what is *listening*, a strict subset. The
mechanics belong to **Port allocation: key, block size, and persistence**, where this
scenario is recorded as an acceptance test.
