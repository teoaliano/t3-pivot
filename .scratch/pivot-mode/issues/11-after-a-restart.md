# After a restart

Type: grilling
Status: resolved
Blocked-by: 07

## Question

What does T3 resume by itself after a server restart, and what does the Pivot learn?

The event store keeps every record, but provider sessions die with the server. Decide
whether T3 resumes interrupted teammates or leaves them for the Pivot, what the Pivot's
first turn after a restart contains, and how pending wakes and open decisions carry
over. firstmate reference: the session-start digest and reconcile rules
(`AGENTS.md` §3 and §5).

## Carried forward from waking the Pivot

The wake cursor advances only when a wake turn completes, and pending wakes are derived
from events, so a restart loses none. The `paused` and stuck timers are rebuilt from
state. Left for this ticket: provider sessions that died with the server, and whether
the first turn after a restart says anything beyond the pending wake.

## Carried forward from steering

Relaunch landed here: restarting a teammate whose session died or wedged. T3 sessions
resume through a resume cursor, so decide whether relaunch resumes or starts fresh with
the brief plus a progress note, as firstmate does.

## Resolution

**Decided 2026-09-29.** T3's startup reconciliation (`apps/server/src/serverRuntimeStartup.ts:481`)
already finds sessions that died with the server.

Adopted from firstmate:

1. **A restart is a non-event** (`VISION.md`, #626). Records rebuild everything. Pending
   wakes and open decisions carry over through the wake cursor (ticket 07).
2. **Only this project's own teammates are recovered.**
3. **Restart in place** in the same thread and worktree, never a fresh copy while the
   worktree is unaccounted for (#619).
4. **Relaunch is a transaction** (#1568): stop the old session, start the new one, and
   report where the work is if the start fails.
5. **The first wake after a restart is a digest,** as firstmate's session start: which
   teammates resumed, which failed to, and every open decision.

Drifts, agreed with the user:

1. **The server resumes teammates itself.** Every teammate the restart interrupted is
   resumed in place, whatever the project's `continueThreadsAfterServerUpdate` says.
   firstmate's first mate decides per crewmate; here the server knows exactly which
   sessions died. A teammate that fails to resume reads `failed` with "did not survive
   restart". While it resumes it reads `working`.
2. **Relaunch resumes the conversation** through T3's resume cursor, instead of
   firstmate's fresh agent reading the brief plus a progress note. A fresh-context
   relaunch can come later. Until then, a teammate stuck in a bad loop is torn down and
   re-dispatched on its branch.

The Pivot's own interrupted turn follows T3's existing restart behavior. Pending wakes
then start the digest turn.

### Knock-on

- Ticket 03 amendment: a session that died in a restart is not a failure while T3
  resumes it.
- Ticket 12 gets the Pivot's `relaunch_teammate` tool in its capability split.
