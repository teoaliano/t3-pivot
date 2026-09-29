# Decisions: escalating to the user

Type: grilling
Status: open
Blocked-by: 03

## Question

How does a decision only the user can make travel from a teammate to the user and back?

firstmate holds a decision as a backlog task, records the captain's verbatim answer, and
closes it by that record (`bin/fm-captain-hold.sh`), with a fixed escalation shape
(evidence, consequence, options, recommendation). T3 has user-input requests
(`thread.user-input.respond`) inside one thread. Decide whether an open decision is a
record of its own or a user-input request on the Pivot thread, where it shows (the Pivot
chat, the teammate's card, both), how the answer returns to the teammate, and how it
survives a restart.

## Carried forward from firstmate contract triage

firstmate contradicts itself: its hold tracking closes a teammate's open decisions when
the teammate reports `done` or `failed` (#3753), while the teammate's instructions say a
`done` line never closes a decision (#1842). Pick one. Keep one record per decision; the
two-record drift guard (#2744) exists only because firstmate kept two.
