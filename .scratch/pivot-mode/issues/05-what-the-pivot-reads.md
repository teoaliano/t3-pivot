# What the Pivot can read about a teammate

Type: grilling
Status: resolved
Blocked-by: 02, 03

## Question

What can the Pivot see of a teammate, and how much does each read cost in context?

firstmate's first mate reads a one-line crew state, status tails, and a bounded pane
capture (`bin/fm-crew-state.sh`, `bin/fm-peek.sh`), and treats token efficiency as a
first-class concern. T3 has `getThreadShellById`, `getThreadDetailById` and the
activity queries. Decide the read tools (list teammates, one teammate's state, a bounded
transcript or the latest assistant message, the diff), their size limits, and whether
the Pivot can read threads that are not its teammates.

## Resolution

**Decided 2026-09-29.** No drifts. Every read copies firstmate, with T3's structured
thread data as the source.

- `list_teammates`: one line per teammate (title, kind, combined status, latest report
  summary, branch, PR, last change). Copies `bin/fm-crew-state.sh`'s "one stable,
  token-tight line" and the session-start fleet digest.
- `read_teammate { teammate, limit? }`: a bounded tail of the teammate's transcript,
  newest first, the latest assistant message always included. Default bound matches
  `bin/fm-peek.sh`'s 40 lines, measured in characters. Swaps the pane capture for the
  transcript.
- `teammate_history { teammate }`: the status reports and decision events, bounded.
  Copies reading the status log.
- The diff and files: the Pivot reads the teammate's worktree with its own tools, as the
  first mate reads projects directly. `list_teammates` gives the worktree path. Ticket
  12 decides that the Pivot's permissions allow those reads.
- Scope: only this project's live teammates. No reads of ordinary or released threads
  ("reconcile only your own", `AGENTS.md:247` at `a09090d`).

### Net-new

The three read tools and their bounds. The data already exists in the thread shell,
thread detail and event store.

### Knock-on

- Ticket 12: the Pivot needs read access to teammate worktrees.

## Amendment from the model change (2026-09-29)

"Its own teammates" means the teammates of that Pivot thread, not of the project.
