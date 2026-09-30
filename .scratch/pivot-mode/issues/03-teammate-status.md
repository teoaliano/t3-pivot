# Teammate status: vocabulary and who reports it

Type: grilling
Status: resolved
Blocked-by: 01, 02

## Question

What statuses can a teammate have, and which does the teammate report versus T3 derive?

firstmate's teammates append `working`, `needs-decision`, `blocked`, `paused`, `done`,
`failed`, `resolved` to a status file. T3 already derives turn state, pending approvals,
pending user input and provider errors from the session. Decide the vocabulary, which
states the teammate reports (and through what, presumably an MCP tool granted only to
teammates), which T3 derives, and what wins when they disagree (a teammate that said
`done` and then crashed).

This is the vocabulary the cards, the wake rules and the decision flow all read.

## Resolution

**Decided 2026-09-29.** firstmate's two layers, with T3's session state as the runtime
evidence.

### Two layers, one function

- **Reported status.** The teammate calls an MCP tool,
  `report_status { state, summary, key?, until? }`, granted only to teammate threads.
  Each call appends a status event. The `teammate` field keeps the latest report and the
  turn it was made in. Copies firstmate's status line
  (`bin/fm-brief.sh:630-660` at `c5f48e4`), minus the parsing.
- **Runtime state.** Derived from what the shell already carries: `hasPendingApprovals`,
  `hasPendingUserInput`, `session.status`, `backgroundLiveness`. Same inputs and order
  as `resolveSidebarThreadStatus` (`apps/web/src/components/Sidebar.logic.ts:840`).
- **Combined status.** One pure function in `packages/shared`, used by the server for
  the Pivot's reads and wakes, and by web and mobile for cards. Copies
  `bin/fm-crew-state.sh`'s rule that the log records events and current state comes from
  runtime evidence.

### Reported vocabulary

`working` (with a phase line, never wakes the Pivot), `needs-decision`, `blocked`,
`paused` (an external wait, optional `until`), `done`, `failed`. firstmate's `note` and
`captain-held` are dropped with the backlog. `resolved` belongs to decisions (ticket 08).

### Combined vocabulary

`working`, `waiting` (approval or user input pending), `needs-decision`, `blocked`,
`paused`, `done`, `failed`, `unreported` (the latest turn ended with no terminal report,
firstmate's stale case).

### Precedence

1. A pending approval or user input is `waiting`.
2. A running turn or background work is `working`, whatever was reported before.
3. Idle: the terminal report from the latest turn counts.
4. Idle with no terminal report in the latest turn: `failed` if the session errored,
   otherwise `unreported`.
5. A terminal report stands over a session error later in the same turn, and the error
   shows in the detail. The delivery gate judges the work, not the session.

Reports are scoped to the turn they were made in, so a steered follow-up that ends
silently reads `unreported`, never a stale `done`.

### Net-new

The `report_status` tool and its teammate-only capability, the status event, and the
combining function. The runtime layer is reused as is.

### Knock-on

- Ticket 07: which combined statuses wake the Pivot. firstmate wakes on `done`,
  `needs-decision`, `blocked`, `failed`, never on `working` or `paused`, and rechecks
  `paused` at `until` or every 4 hours. `unreported` is new.
- Ticket 08: `needs-decision` and `resolved` open and close decisions. A `working` or
  `done` report never closes one, the brief side of firstmate's contradiction.
- Ticket 09: whether `report_status` refuses a ship's `done` without a linked PR
  (firstmate #4878 refuses a `done` whose head exists only locally).
- Ticket 12: the teammate-only capability joins the capability split.
- Ticket 16: how each combined status looks on a card.

## Amendment from after a restart

Precedence rule 4 does not apply to a session killed by a server restart while T3
resumes it: the teammate reads `working`. Only a failed resume reads `failed`.
