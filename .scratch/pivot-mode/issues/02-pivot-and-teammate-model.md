# Pivot and teammate in the orchestration model

Type: grilling
Status: resolved
Blocked-by: 01

## Question

How do the Pivot and its teammates exist in T3's event-sourced model?

Options range from a role field and a parent link on the existing thread aggregate
(`pivotThreadId` on a teammate, a Pivot marker on the project) to a separate teammate
aggregate that references a thread and carries the task contract, kind (ship or scout)
and status. Decide which, which new commands and events it needs, and how the read model
exposes it to the Pivot view and the sidebar grouping.

Constraints: a project has at most one Pivot. A teammate is 1:1 with a worktree, as in
firstmate's pool slots and T3's managed-process ownership. The shape must survive a
server restart with nothing held in memory. firstmate reference: `state/<id>.meta`,
`data/<id>/brief.md`.

## Resolution

**Decided 2026-09-29.** Both records copy firstmate's shape, mapped onto T3's two existing
aggregates. No third aggregate kind.

### The mapping

| firstmate                                                       | T3 Pivot                       | Why it matches                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Task (`state/<id>.meta`, `data/<id>/brief.md`)                  | Teammate thread                | The durable unit of work, 1:1 with a worktree.                                                                                   |
| Endpoint (the agent session in a pane)                          | Provider session               | Replaceable underneath. A relaunch keeps the task and its worktree (`docs/agent-control.md:37`), as a new turn keeps the thread. |
| `kind=` in meta, flipped by promotion (`bin/fm-promote.sh:2-4`) | `teammate.kind` on the thread  | Promotion changes the kind in place.                                                                                             |
| Home, one per captain                                           | Project in Pivot mode          | Tasks belong to the home, not to one first-mate session.                                                                         |
| Per-home session lock (`bin/fm-lock.sh`)                        | `pivotThreadId` on the project | One slot. A new session takes the slot and reconciles the same tasks.                                                            |

One difference: firstmate's lock is live (a pid), and T3's pointer is durable. T3 threads
outlive provider sessions, so the pointer does not need liveness.

### Decisions

1. **A teammate is a thread with a `teammate` field**, null on ordinary threads. A
   dispatch event sets it once. It holds the kind (ship or scout) and the latest reported
   status. Precedent: pull requests, snooze and pin, each an optional thread field with a
   projection column and a migration (`034`, `036`, `049`, `050`).
2. **The Pivot is `pivotThreadId` on the project.** Set means Pivot mode, clearing it
   leaves Pivot mode, and "at most one Pivot" holds by construction.
3. **Teammates belong to the project, not to a Pivot thread.** Whichever thread
   `pivotThreadId` names supervises every live teammate. A fresh Pivot conversation is a
   pointer swap, and the old Pivot thread stays as an ordinary thread.
4. **The shell stays small.** The thread shell carries `teammate: { kind, status }`, and
   the project shell carries `pivotThreadId`. The brief (intent, spec, definition of done)
   rides the dispatch event and thread detail only.
5. **No adoption, but release exists.** Teammates come only from dispatch, following
   firstmate's "reconcile only your own" (`AGENTS.md:247` at `a09090d`). A release event
   clears the field, and the thread keeps its history as an ordinary thread.
6. **Every teammate has its own worktree, enforced by the server.** Dispatch refuses when
   no worktree results. This replaces firstmate's worker-side isolation check
   (`bin/fm-brief.sh:467-469`, from `10850ad9` #83). Pivot mode needs a git repository.
7. **Only the Pivot dispatches.** The server refuses dispatch from any other thread, so
   nested supervisors stay out of scope by construction.

### Net-new

The `teammate` thread field, `pivotThreadId` on the project, and dispatch and release
events. Nothing existing records a supervisor relationship.

### Knock-on

- Ticket 03 decides what `teammate.status` holds.
- Ticket 04's dispatch carries the brief in its event and refuses without a worktree.
- Ticket 13 decides when release fires, whether "start a fresh Pivot" is offered, and
  what a non-git project shows.

## Amendment from entering and leaving Pivot mode (2026-09-29)

The user ruled that a Pivot is permanent: a Pivot thread never becomes an ordinary thread,
and a teammate never stops being a teammate. That replaces decisions 2, 3 and 5.

- **A Pivot is a thread kind.** A `pivot` field on the thread, set at creation and never
  cleared. It replaces `pivotThreadId` on the project.
- **One active Pivot per project.** The server refuses a second Pivot in a project that
  is not retired. This copies firstmate's one first mate per home and restores the
  charting decision in a new shape. Several active Pivots were considered and dropped: they need a
  second creation path ("start empty or take over which one?") for a use case the user
  called narrow.
- **A teammate belongs to one Pivot thread:** `teammate.pivotThreadId`. A retired Pivot
  keeps its finished teammates nested under it in the sidebar.
- **Creating a Pivot while one is active is a handover.** The active Pivot moves every
  live teammate, open decision and pending wake to the new one in one event, and becomes
  **retired**. "New Pivot" confirms first ("this takes over 5 live teammates and 1 open
  decision from Integrate firstmate"). With no active Pivot, "New Pivot" starts empty.
  This matches firstmate's "a restart is a non-event": a new first-mate session picks up
  the home's tasks from records.
- **A retired Pivot is read-only history.** Composer hidden. The way back to what it knew
  is the new Pivot reading its transcript (ticket 13).
- **No release, no adoption.** The release event is gone. Taking a teammate over means
  typing into it from the sidebar.
- **The Pivot home stays one per project,** shared by the active Pivot and every retired
  one.

"Retired" is the name, not "settled": T3 already uses "settled" for a thread lifecycle
state in the sidebar.
