# Teammate status: vocabulary and who reports it

Type: grilling
Status: open
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
