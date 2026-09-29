# Waking the Pivot

Type: grilling
Status: open
Blocked-by: 03

## Question

When does T3 start a Pivot turn on its own, and what does that turn say?

Decide which teammate events wake the Pivot, how several events arriving together batch
into one turn, what happens if the Pivot is already mid-turn or the user is typing to
it, how a wake is shown in the Pivot's chat (visible message, collapsed notice, hidden),
and how a wake is acknowledged so none is lost or repeated across a restart.

firstmate reference: `.wake-queue` with generation-bound `--ack-through`,
`bin/fm-watch.sh`, `bin/fm-wake-lib.sh`. T3 reference: reactors subscribing to domain
events (`ThreadSettlementReactor.ts:334`).
