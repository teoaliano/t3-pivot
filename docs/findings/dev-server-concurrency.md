# Dev servers across concurrent worktrees — findings

**Status: findings only. No decision has been made.**
Recorded 2026-09-18. This file exists so the decision can be made later with evidence
rather than re-derived from memory. Nothing here authorizes an implementation.

Sources: the `worktree-dev-server` skill (port attribution rules, in daily use by the
author across ~3 concurrent worktrees), the T3 Code repo at `pingdotgg/t3code`, and the
firstmate repo at `kunchenguid/firstmate`.

---

## 1. The problem

T3 Pivot dispatches N parallel worktrees, each potentially running a dev server. Agents
inspect their own work through a preview, so a server must be running *at the moment*
the owning agent needs it.

Two distinct failure modes, often conflated:

| Failure | Cause | Severity |
|---|---|---|
| **Cross-wiring** | Two worktrees' servers are indistinguishable by port; a preview shows the wrong checkout | Silent and dangerous — work is approved against the wrong app |
| **Exhaustion** | 6–10 concurrent dev servers exceed host RAM / CPU / file watchers | Loud — machine degrades, but nothing is silently wrong |

Cross-wiring is the worse of the two and the cheaper to fix. They should be solved
separately and in that order.

## 2. What T3 Code already provides

Verified by reading the repo, not inferred:

- `ProjectScript` (`packages/contracts/src/t3ProjectFile.ts`) — checked-in `t3.json`
  entries carrying `command`, `previewUrl`, `autoOpenPreview`, `runOnWorktreeCreate`.
- Running a script (`apps/web/src/components/ChatView.tsx:4140`) opens a thread-scoped
  terminal in the worktree and types the command. Fire and forget: no record binds the
  script to a server, a port, or a lifecycle.
- `PortScanner` (`apps/server/src/preview/PortScanner.ts`) — parses
  `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`, publishes a port only after a bounded HTTP
  probe returns HTML or a redirect to one. **Already yields a pid per port.**
- `PreviewManager` — sessions keyed by `(threadId, tabId)`.
- Terminal lifecycle RPCs: `terminal.open/close/restart/attach/write/resize`.
- `server.signalProcess`, `server.getProcessResourceHistory`, `server.getHostResources`
  (backed by a Rust `resource-monitor`).
- `ThreadBackgroundLiveness` — in-memory per-thread live-work state, already driving the
  sidebar pill. Deliberately empty after a server restart: "orphaned background work is
  not live."

**Gap:** nothing models "this script is a long-running server owned by this worktree."

## 3. Port attribution — adapting the `worktree-dev-server` skill

The skill's core claim transfers intact:

> A port carries no evidence of which checkout is behind it.

Its ground truth is process working directory: resolve the pid holding the port, read the
pid's `cwd`, compare against `git rev-parse --show-toplevel`. `MINE` / `FOREIGN` / `free`.
T3's `PortScanner` already extracts the pid, so **the attribution step is a small addition
to code that already runs**, not new infrastructure.

### What transfers directly

1. **cwd-based attribution as the only proof.** A boot log that printed the requested port
   states intent; the running process's cwd is evidence. Port checks in T3 Pivot should
   resolve to a worktree path, never to "in use."
2. **Fail rather than slide.** Frameworks that auto-increment off a taken port are the
   direct cause of cross-wiring: the server lands somewhere T3 does not expect and the
   preview silently points at a neighbour. Inject the port *and* the strict flag —
   Vite `--port $PORT --strictPort`, Next `-p $PORT` (already strict), Expo `--port`,
   plain Node via its `PORT` env var. An error is recoverable; a slide is not.
   `runProjectScript` already accepts an `env` option, so the injection point exists.
3. **Move the whole stack together.** A repo with a client and an engine has ≥2 ports.
   Allocate a contiguous block per worktree so the client still finds its engine.
4. **Never kill a `FOREIGN` server.** It belongs to work this session cannot see.
   Good default for any future reaper: only ever stop what you started.
5. **Release on the way out.** Per the skill: "A worktree's removal never stops the process
   behind it." See the open bug in §6.

### What should change

The skill derives ports by hashing the branch name (`cksum(branch) % 200`) and probing
upward on collision. That is correct for an agent with **no coordinator** — it is stable
across sessions and needs no shared state.

T3 Pivot *has* a coordinator. The server owns worktree creation and knows every session,
so it can keep an authoritative allocation keyed by worktree path instead of hashing and
hoping. That removes the skill's own stated wart:

> Two branches can hash to one offset. The loop above absorbs that, at the cost of the
> port changing between sessions.

Keep cwd attribution as the verification step regardless of how the port is chosen — it is
what catches a framework that ignored the injected port.

## 4. Why a hard concurrency cap was rejected

An LRU cap ("max N dev servers, stop the coldest on start") was proposed and **does not
survive contact with the real workload**: with 6–10 worktrees under active inspection,
every server is legitimately in use at the moment its agent needs it. A count-based cap
would stop a server an agent is mid-inspection on.

The binding constraint is not *count*, it is *host resources*, and per-server cost varies
by more than an order of magnitude (an idle Vite server is ~100 MB; a Next dev server
mid-compile is GBs). Any rule keyed on count is measuring the wrong thing.

## 5. Candidate mechanisms

Recorded with tradeoffs. **Not ranked as a recommendation.**

**A. Resource-budgeted admission control.**
Check `server.getHostResources` before start; admit if projected free RAM stays above a
floor. Deterministic and already backed by shipped telemetry. Needs a per-server cost
estimate, which is a guess on first run and learnable from `getProcessResourceHistory`
afterward.

**B. Queue and wait for a slot.**
The agent requests a server and blocks until one frees. Matches the author's instinct.
**Carries a real deadlock:** if every agent must inspect before finishing, and all slots
are held by agents waiting to inspect, nothing ever releases. Would need preemption or a
timeout to be safe, and a blocked agent burns a session doing nothing. Flagged as the
highest-risk option.

**C. Leases with pressure-triggered reaping.**
Every server holds a lease renewed by activity (preview open, live turn in the owning
thread). No cap on count. Under memory pressure, reap the coldest lease. Addresses the
objection in §4 directly: a server under active inspection always renews.
`ThreadBackgroundLiveness` already supplies the liveness half of the signal.

**D. Lazy start / eager stop.**
Do not start a server at worktree creation. Start when a preview is actually opened; stop
on close plus a grace period. Steady state becomes "only servers someone is looking at."
Composes with C; reduces the pressure C has to manage.

**E. One shared server switching checkouts.** Discarded — defeats worktree isolation.

Author's lean at time of writing, held loosely: **D then C, with A as a safety valve, and B
rejected on deadlock risk.** To be re-examined against §7 evidence.

## 6. Process-lifetime gaps (corrected 2026-09-21)

An earlier draft of this file claimed two bugs. Re-checked against the source; the first is
narrower than stated and the second is not established. Both are **T3 Code upstream**, not
fork-introduced.

### 6a. The main delete path is correct

`useThreadActions.ts:386-425` does the right thing in the right order: stop the provider
session, `closeTerminal({ threadId, deleteHistory: true })`, delete the thread, *then*
`removeWorktree({ force: true })`. Terminals are closed before the worktree goes. The
original claim was wrong for this path.

### 6b. Two secondary paths remove a worktree without closing terminals

`GitVcsDriverCore.ts:3396` is a thin wrapper over `git worktree remove [--force] <path>`
with no process handling at all — correct for a git driver, but it means every caller owns
process cleanup. Two callers do not do it:

- **`ws.ts:3305`** — the raw `vcs.removeWorktree` RPC behind the source-control UI action.
  No terminal close. Anything serving out of that worktree keeps serving.
- **`storageCleanup.ts:355`** — a background reaper that removes idle worktrees
  unattended. It takes a workspace lease, but **a lease is not a process check**. It
  deliberately preserves branch and path so `ProviderCommandReactor` can recreate the
  checkout on resume, so a user may never notice the orphan. This is the one that matters:
  it is automatic.

Severity is modest on its own (a stale server serving deleted code, which §3's cwd
attribution would catch as `FOREIGN`), but it compounds directly with the capacity problem
in §1 — orphans consume the resources §5 is trying to budget, and nothing reclaims them.

### 6c. Grandchild kill: MEASURED 2026-09-21, not a bug

Earlier drafts asserted that "closing a terminal doesn't reliably kill the server", then
demoted it to an open measurement. The measurement has now been run against a real pty on
macOS:

| Case | Grandchild survives SIGTERM to grace to SIGKILL on the pty? |
|---|---|
| Ordinary child, same session, master left open | No |
| Ordinary child, master closed | No |
| Child in its own session (`os.setsid()`) | **Yes, orphan** |
| Child ignoring `SIGHUP` | **Yes, orphan** |

The mechanism is session leadership rather than the master fd: the pty child is a session
leader, so its death makes the kernel `SIGHUP` the foreground process group. Whether the
master is closed makes no difference.

**The original claim was wrong.** `TerminalManager.runKillEscalation` already handles the
real case, and `pnpm dev` spawning vite is the real case. The two escapes are narrow and
not behaviours normal dev servers exhibit.

Design consequence, settled in the orphan-reaping ticket: no process-group killing.
Rely on the existing teardown, verify the reserved port was released, and escalate only
on failure using recorded descendant pids.

### 6d. Stopgap available today

The `worktree-dev-server` skill's Step 5 sweep — enumerate listening pids, keep those whose
cwd equals the worktree root — is a complete fix for 6b that needs **no session record and
no Tier 0**. It could be wired into the two callers now. The better fix ("stop the servers
this worktree owns") needs Tier 0's session record, so the sweep is the honest interim.

## 7. What would settle this

Each is measurable once Tier 0/1 ships, and none requires committing to a mechanism:

1. Real per-server memory and CPU cost across the author's actual projects
   (`server.getProcessResourceHistory` already records this).
2. How long an agent actually holds a preview within a turn — seconds or minutes?
3. Whether agents need a server *across* turns or only *within* one. If only within,
   D alone may be sufficient and C is unnecessary.
4. Whether the deadlock in B occurs in practice or is theoretical at realistic fleet sizes.
5. The real ceiling on this machine: how many concurrent dev servers before degradation,
   measured rather than assumed.
6. ~~Does a terminal close actually kill `pnpm dev` and its vite child?~~ **Answered
   2026-09-21 — see §6c. Yes for the ordinary case; no process-group work needed.**

## 8. Note on what the first mate should know

The supervisor's instinct is to model host capacity and throttle dispatch. firstmate's own
VISION.md argues against it:

> Logic that can be exact lives in deterministic scripts; work that requires understanding
> lives in an agent. A rigid script must never adjudicate meaning, and intelligence must
> never be spent on what a script can do exactly and repeatably.

Dev-server admission is exact. It belongs in the allocator, not in the first mate's
judgment. The supervisor should dispatch on *dependency* grounds alone and let admission
control serialize previews underneath it — which also keeps a host-resource model out of
the supervisor's context, consistent with the context discipline in §2 of the fork notes.

The first mate needs exactly one new captain-facing outcome: *"preview unavailable, queued
behind other work."* It does not need a resource model.
