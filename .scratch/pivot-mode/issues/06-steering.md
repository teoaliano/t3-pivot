# Steering a teammate

Type: grilling
Status: resolved
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

## Carried forward from decisions

When the Pivot relays an answer, the steering message names the decision it answers and
closes it at send time (answerer closes, firstmate #1842). The send refuses a decision
that is not open.

## Carried forward from dispatch and the brief

Messages the Pivot sends a teammate carry a Pivot marker and render as the Pivot's words.
Steering uses the same marker, so the look is decided.

## Resolution

**Decided 2026-09-29.**

Adopted from firstmate:

- Queue is the default. A message to a busy teammate waits for its turn to end, as a busy
  worker waits in firstmate. The queue lives on the server. T3 only queues in the web
  client today.
- Messages and lifecycle stay separate (`docs/agent-control.md`, #1568). The Pivot gets
  interrupt (`thread.turn.interrupt`) and stop (`thread.session.stop`) as tools
  addressed to an exact teammate. Teardown and discard are never messages. Relaunch goes
  to ticket 11.
- Exact target or refuse (#254). The server refuses an empty message and any target
  that is not a live teammate of this project.
- The user's asks join the intent (#3597). `message_teammate` takes an optional `intent`
  with the user's words verbatim, separate from the Pivot's `text`. The server appends it
  to the teammate's recorded intent. The brief stays write-once.
- The durable record is the delivery. The tool result says queued or delivered. This
  swaps firstmate's inbox files, acknowledgements and 90 s re-ring (#2856) for T3's
  direct delivery into the provider session. Same guarantee, no terminal to lose input.

The tool: `message_teammate { teammate, text, intent?, delivery: "queue" | "steer",
answers? }`. `answers` names the decision the message closes (ticket 08).

Drifts, agreed with the user:

1. **A steer delivery.** The Pivot can inject a message into the running turn, which T3
   supports (`ClaudeAdapter.ts:5153`). For urgent corrections, so interrupting and losing
   in-flight work is not the only fast lever. Queue stays the default.
2. **The user can type into a teammate thread from the default view's sidebar.**
   firstmate's hard rule 4 says the captain talks only to the first mate. Here the
   message is recorded as the user's and wakes the Pivot with the text verbatim. The
   Pivot view stays read-only. Taking a teammate over completely means releasing it.

### Knock-on

- Ticket 07 amendment: a user's direct message to a teammate is a wake item.
- Ticket 11: relaunching a dead or wedged teammate.
- Ticket 13: releasing a teammate is how the user takes it over.
- Ticket 17: the teammate composer is hidden in the Pivot view, present in the default
  view.
