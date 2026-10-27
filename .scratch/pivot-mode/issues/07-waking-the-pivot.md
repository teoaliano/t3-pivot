# Waking the Pivot

Type: grilling
Status: resolved
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

## Carried forward from teammate status

The combined vocabulary is `working`, `waiting`, `needs-decision`, `blocked`, `paused`,
`done`, `failed`, `unreported`. firstmate wakes on `done`, `needs-decision`, `blocked`,
`failed`, never on `working` or `paused`, and rechecks `paused` at `until` or every
4 hours. Decide the wake set, including `waiting` and the new `unreported`.

## Resolution

**Decided 2026-09-29.** A server reactor wakes the Pivot, following the
`ThreadSettlementReactor.ts:334` pattern. The rules copy firstmate's wake queue
(`AGENTS.md` wake sections, `bin/fm-watch.sh`) and replace its pane evidence with T3's
activity stream.

1. **Wake set.** `done`, `needs-decision`, `blocked`, `failed`, `unreported` and
   `waiting` wake the Pivot. `working` never does. `paused` does not, but its `until`
   time does, and a `paused` with no `until` is rechecked every 4 hours (firstmate
   `40c50ea8` #4048). `waiting` wakes because a teammate stuck on an approval or a
   question stops until someone answers, and teammates never address the user.
2. **Stuck bound.** A running teammate with no activity for 30 minutes wakes the Pivot
   once per turn, for inspection. Never an automatic interrupt. Replaces firstmate's
   3,600 s busy bound (#1286) and pane-hash stale detector with the activity stream.
3. **No heartbeat.** firstmate's 600 to 7,200 s review covered what its watcher could
   miss. Exact events, `paused` rechecks and the stuck bound cover it here.
4. **Batching.** After the first transition, collect for 30 s, then send one wake
   (firstmate's window, `9931f81e` #4). Turn scoping already folds a teammate's report
   and its turn end into one transition.
5. **Never mid-turn.** A wake waits until the Pivot's current turn ends, then one wake
   turn carries everything pending. It is never steered into a running turn, which is
   what a server-side `thread.turn.start` does today (`ClaudeAdapter.ts:5153`). User
   messages during a wake turn follow the user's `followUpBehavior`.
6. **What a wake says.** A new message kind in the Pivot's thread, sent to the provider
   as text: each teammate that changed since the last wake (title, status, summary),
   then every open decision (firstmate `bb352e7b` #1711). The Pivot chat shows it as a
   collapsed notice the user can expand. Never hidden, never shown as the user's words.
7. **Acknowledgement.** The Pivot has a wake cursor, the event sequence it has been
   shown through. Pending items are the transitions after it. The cursor advances only
   when the wake turn completes, so an interrupted wake turn re-presents the same items
   (firstmate `f9b9d43c` #2065). Changes the Pivot causes itself never wake it
   (#4895, #4907). Pending wakes are derived from events, with no separate queue store.
   The `paused` and stuck timers are rebuilt from state after a restart.

### Net-new

The wake reactor, the wake message kind and its collapsed rendering, and the wake
cursor. Nothing in T3 starts a turn on one thread because of another.

### Knock-on

- Ticket 05: the wake stays short, so the Pivot's read tools carry the detail.
- Ticket 09: delivery events (PR merged, checks changed) and whether they wake.
- Ticket 11: what the first turn after a restart shows, given the cursor.
- Ticket 15: the collapsed wake notice is part of the Pivot chat's look.
- Ticket 18: notifications key off the same transitions.

## Amendment from decisions

The user answering an escalated decision is a wake item, alongside the status
transitions above.

## Amendment from steering

A message the user types directly into a teammate thread is a wake item, carrying the
text verbatim.

## Amendment from the model change (2026-09-29)

Wakes and the wake cursor belong to a Pivot thread. A handover moves pending wakes to the
new Pivot.
