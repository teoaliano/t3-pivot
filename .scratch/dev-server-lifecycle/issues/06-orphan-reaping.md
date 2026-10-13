# Orphan reaping across restarts and the two unguarded callers

Type: grilling
Status: resolved
Blocked-by: 01, 02

## Question

Two related lifetime gaps, both verified in the source and recorded in findings §6b:

1. `ws.ts:3305` (`vcs.removeWorktree` RPC) and `storageCleanup.ts:355` (background reaper)
   remove a worktree without closing its terminals. The main thread-delete path
   (`useThreadActions.ts:386-425`) already does this correctly and is not affected.
2. A T3 server killed with SIGKILL never runs finalizers, so managed sessions outlive it.

`LocalDeviceHost.reapStaleHub` (:269-303) is the template: persist `{pid, port, entryPath}`,
and on next start check pid liveness *and* match the command line before signalling,
because pids get recycled.

Decide: the record's format and location, what identity we match on, when the reap runs,
and how the two callers above hook into session teardown.

Findings §6c is an open *measurement*, not a decision: does closing a terminal already kill
`pnpm dev`'s vite child via pty SIGHUP? If yes, much of this is free. Run that experiment
before resolving this ticket.

---

## Measurement first (§6c), run 2026-09-21

Ran the experiment this ticket asked for, against a real pty on macOS.

| Case | Grandchild survives the kill? |
|---|---|
| Ordinary child, same session, pty master left open | **No** |
| Ordinary child, master closed | **No** |
| Child in its own session (`os.setsid()`) | **Yes, orphan** |
| Child ignoring `SIGHUP` | **Yes, orphan** |

The mechanism is session leadership, not the master fd. The pty child is a session leader,
so the kernel sends `SIGHUP` to the foreground process group when it dies. Closing the
master is irrelevant.

**Therefore the existing SIGTERM → grace → SIGKILL in `TerminalManager.runKillEscalation`
already handles the real case.** `pnpm dev` spawning vite is the ordinary case; neither
escape is something a normal dev server does. The earlier claim in findings §6c that
"closing a terminal doesn't reliably kill the server" was too strong and is corrected.

(A first run reported the detached case as cleaned up. That was an invalid test: macOS has
no `setsid(1)`, so the command never ran. Retested with `os.setsid()` in-process.)

## Resolution

**Decided 2026-09-21.** Reuse-first throughout; almost nothing here is new.

### Managed processes run in T3 terminals

Not directly spawned children. The user sees output, scrollback already persists to log
files under the state directory, and the terminal is typeable. Rebuilding output display
around a directly-spawned child would duplicate a working subsystem to gain exact kills
for two escapes that real dev servers do not take.

Consequence, recorded deliberately: **the pid we hold is the shell's, not the server's.**
That is acceptable given the measurement, and `deriveSubprocessInspectResult`
(`Manager.ts:690-716`) already walks the descendant tree and registers those pids with
`PortScanner`, so the real pids are obtainable when needed.

### No process-group killing

Rely on the existing pty teardown, then **verify the reserved port was released**, and
escalate only on failure. We know which port should free and the scanner already probes,
so verification is nearly free.

Defensive group-killing was rejected on a specific hazard: the pid we hold is a shell's,
so its process group may contain things we did not start. Escalation instead uses the
recorded descendant pids, verified before signalling.

### The two unguarded callers

`ws.ts:3305` and `storageCleanup.ts:355` both get a single `stopAllForCheckout(path)`
call, executed **as part of removal** rather than as a courtesy.

This is extraction, not invention: `useThreadActions.ts:386-425` already performs the
correct sequence by hand (stop session → `closeTerminal({deleteHistory: true})` → delete →
remove worktree). Lift that ordering into one helper and have all three call it.

`storageCleanup` is the one that matters. It runs unattended and deliberately preserves
branch and path so the thread can resume, so an orphan it creates is invisible.

### Cross-restart record

Copy `LocalDeviceHost.reapStaleHub` (`:269-303`) rather than designing something. Match on
**pid liveness, command line, and port**: `process.kill(pid, 0)`, then `ps -o command=`
compared against the recorded command, then confirm the port still belongs to that pid.
Three signals because the port is free to check and the comment there names the hazard
exactly: "a recycled pid belonging to something else is never touched."

Storage is the same global `baseDir` sidecar holding reservations and pins — one file, one
read at startup, no new location.
