# Port allocation: key, block size, and persistence

Type: grilling
Status: resolved
Blocked-by: —

## Question

The `worktree-dev-server` skill derives a port by hashing the branch name and probing
upward, because an agent working alone has no coordinator. T3 Pivot has one, so it can
allocate authoritatively.

Decide: what is the allocation keyed on (worktree path? project + worktree?), how many
ports does a session get (a client + engine stack needs ≥2 — the skill applies one offset
to the whole set so they move together), what range do we allocate from, does an
allocation persist across restarts so a worktree keeps its port, and what happens when the
allocated port is already taken by something we do not own.

Coupling, not a blocker: whether an allocation *persists* across restarts depends on
where session state lives (ticket 01). The rest of this question stands alone — resolve
what you can and flag the persistence sub-decision if 01 is still open.

Note firstmate's precedent: `fm-spawn.sh` refuses a spawn when a pool slot cannot be
claimed, rather than sliding to another. Consider whether allocation should fail the same
way.

---

## Carried forward from [Session record](01-session-record-durable-or-runtime.md)

That ticket settled the *storage* (one global sidecar, reservations durable) and left the
*mechanics* here. It also added constraints and an acceptance test.

**Acceptance test — the stolen-port scenario.** W1 is created and reserves 3000. W1's dev
server is stopped. W2 is created and starts a dev server. W1 then restarts its dev server.
W1 must get 3000 back; W2 must never have been offered it.

This is only satisfiable by allocating through **reservation, not observation**: a registry
knows what is *claimed*, `lsof` only knows what is *listening* — a strict subset. The
user's own `worktree-dev-server` skill probes with `lsof` because an agent working alone
has no coordinator; T3 Pivot has one and must not inherit that limitation.

**Settled upstream of this ticket:** reservation grain is a **block per worktree** (records
are per `(worktree, script)` and draw from their worktree's block), so decide block size
here, not grain.

**Additional questions this ticket now owns:**
- **When is a reservation claimed?** "At worktree creation" is the intent, but T3 creates
  worktrees from several places — `vcs.createWorktree`, worktree-on-thread-create, and
  `ProviderCommandReactor` recreating a checkout after storage cleanup. Decide the single
  hook, or accept several.
- **Reclamation.** A reservation must be released on worktree removal or the range leaks —
  the user cycles worktrees frequently, so this is a live risk, not a theoretical one.
  What reaps reservations whose worktree no longer exists on disk (removed while T3 was
  down, or outside T3 entirely)?
- **Write contention.** One global file with several writers (allocation, pid recording,
  reaping). Decide the serialization discipline — the codebase convention is one
  `Semaphore.make(1)` per state machine plus `writeFileStringAtomically`.
- **Reserved-but-FOREIGN.** What happens when a worktree's reserved port is held by a
  process that is not ours? Coordinate with
  [Attribution and FOREIGN handling](04-attribution-and-foreign.md) rather than deciding
  the attribution mechanism here.

---

## Resolution

**Decided 2026-09-21.**

### The scheme

- **Block per worktree, fixed size 10, contiguous.** Predictable: a worktree's whole range
  is knowable from its base, and "apply the same offset to every port so the stack moves
  together" falls out for free. On-demand allocation was rejected because a worktree's
  second port could land nowhere near its first, breaking exactly that property.
- **Range 11000–12999** (base 11000, 200 blocks). Clear of `COMMON_DEV_PORTS`
  (`3000, 3001, 3333, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081,
  8888, 9000`), which is what users' own configs default to, and below every OS ephemeral
  range (Linux from 32768, macOS from 49152) so the kernel can never hand a reserved port
  to something else. Base is configurable but undocumented: an escape hatch, not a knob.
- **Keyed on worktree path**, and path reuse **inherits** the block. Paths are
  deterministic — `worktreesDir/<repoBasename>/<branch-with-slashes-dashed>`
  (`GitVcsDriverCore.ts:3053-3056`) — and reuse is by design: `ProviderCommandReactor`
  deliberately recreates a vanished worktree at the identical path. Inheriting is the only
  rule consistent with that, and it cannot leak by construction.
- **Reserved, never observed.** A registry knows what is *claimed*; `lsof` knows only what
  is *listening*, a strict subset. This is what satisfies the acceptance test above.

### Claiming

`ensureReservation(worktreePath)` — **idempotent, called whenever a managed process
starts**, not only at worktree creation. Hooking creation alone has paths that miss it:
`GitManager.preparePullRequestThread` has a *reuse* branch returning an existing worktree
without creating one (`GitManager.ts:2504,2530`), and `ProviderCommandReactor.ts:505`
recreates worktrees automatically. Ensure-on-use cannot be missed by construction.

`GitVcsDriverCore.createWorktree` (`:3050`) is hooked as well, purely so the reservation
usually exists before anything asks. It is the single primitive under all four creation
callers, so one hook covers them.

### Releasing

Released when T3 removes the worktree, **plus a periodic reconcile** that frees
reservations whose path no longer exists on disk. Worktrees get removed behind T3's back —
`git worktree remove` from a shell, or removal while T3 is down — and worktrees here are
cycled often, so a leak-only-on-the-unhappy-path design would leak in practice. The
reconcile's cadence and owner belong with
[Reaper policy](07-reaper-policy.md), which already runs a sweep.

### On conflict: refuse

If a reserved port is occupied when a managed process starts, **refuse and name the
occupant**; offer an explicit "reallocate this worktree's block" action. Sliding to the
next free port is the failure this whole effort exists to prevent, and doing it inside T3
while telling users to pass `--strictPort` would be incoherent. firstmate sets the same
precedent: `fm-spawn.sh` refuses when a pool slot cannot be claimed rather than picking
another. Identifying *who* holds the port is
[Attribution and FOREIGN handling](04-attribution-and-foreign.md).

### Storage

One global file under **`baseDir`**, not `stateDir`. Worktrees live at
`baseDir/worktrees` (`config.ts:151`) while `stateDir` splits into `dev` and `userdata`
(`config.ts:135`). A reservation keyed on a worktree path must live where that key is
valid; in `stateDir` the key's domain would be wider than the file's, and two instances
sharing worktrees would double-allocate. Written with `writeFileStringAtomically`
(no locking, last-write-win) behind one `Semaphore.make(1)`, and self-versioned in the
shape of `PersistedServerRuntimeState` (`serverRuntimeState.ts:11`).

### Accepted limitation

Worktree paths use the repo *basename*, so two different repositories both named `api`
resolve into one `worktrees/api/` directory and can collide on path. This is pre-existing
T3 behaviour — such repos already collide at the git level before reservations are
involved — and is inherited rather than fixed here.

### Useful findings for downstream tickets

- `projectScriptRuntimeEnv` (`packages/shared/src/projectScripts.ts:58`) already injects
  `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` with `extraEnv` spread last. Port
  injection is a few lines in a shared helper, not surgery on `ChatView.tsx`.
- `PortScanner` already maps PIDs to `{threadId, terminalId}`
  (`registerTerminalProcesses`, `:595`) and `TerminalManager.open` carries `worktreePath`
  (`:266`). Process↔worktree is solved; only port↔worktree was missing.
- `Net.ts` has `reserveLoopbackPort` (`:158`) but it binds port 0, reads the number and
  closes immediately — a TOCTOU hint, not a held lease. `findAvailablePort(preferred)`
  (`:195`) is still useful for the occupancy check.

---

## Amendment (2026-09-21), from [Preview binding](05-preview-binding.md)

**The reservation key was wrong.** This ticket recorded "keyed on worktree path". That
collapses every non-worktree thread into a single null bucket.

`ThreadEnvMode` is `["local", "worktree"]` (`packages/contracts/src/environment.ts:59-60`)
and **`local` is the shipped default**
(`packages/contracts/src/settings.ts:1179-1181`). A local thread has
`worktreePath === null`; the project root is not stored, it is substituted at each use
site as `worktreePath ?? project.workspaceRoot` (`ws.ts:3190` and others).

**Corrected key: `worktreePath ?? project.workspaceRoot`** — a checkout path, where a
worktree is one kind of checkout and a project root is another. Everything else in the
resolution stands: blocks of 10, reuse inherits, reserved not observed.
