# Steering a teammate

Type: grilling
Status: open
Blocked-by: 02

## Question

How does the Pivot send a teammate a follow-up, and what happens if the teammate is
mid-turn?

firstmate writes to a per-task inbox, rings a doorbell into the terminal, and re-rings
until the worker acks (`bin/fm-task-inbox-lib.sh`). T3 can start a turn directly. Decide
whether a message to a running teammate queues until the turn ends, interrupts it, or
lets the Pivot choose, whether steering messages look different from user messages in
the teammate's chat, and how the Pivot learns the message landed. Include the
interrupt and stop controls (firstmate's `bin/fm-control.sh`).

## Carried forward from firstmate contract triage

In the default view a teammate is an ordinary sidebar thread, so the user can type into
it directly. Decide whether the Pivot hears about those messages, and how, so its record
of the teammate does not go stale.
