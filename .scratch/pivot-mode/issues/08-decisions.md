# Decisions: escalating to the user

Type: grilling
Status: resolved
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

## Carried forward from teammate status

A teammate opens a decision by reporting `needs-decision` with an optional `key`.
`resolved` is not a status verb. It belongs to this ticket. Teammate status already
rules that a `working` or `done` report never closes a decision.

## Resolution

**Decided 2026-09-29.** One decision record in two stages, copying firstmate's keyed fold
(`bin/fm-classify-lib.sh:413-446`), captain hold (`bin/fm-captain-hold.sh`) and
`ask-user-authority`, without firstmate's second record.

1. **One record.** A decision belongs to the project, optionally links to a teammate,
   and carries a key (`default` when none is given). A teammate's `needs-decision` or
   `blocked` report opens one. The Pivot can open one directly for its own questions.
   It is not a provider user-input request, because those block the asking turn and a
   Pivot waiting on the user would stop supervising. One record removes firstmate's
   divergence guard (#2744).
2. **Two stages.** A decision starts with the Pivot. The Pivot answers anything
   unambiguous toward the user's stated intent and escalates only contract expansion,
   unsettled product or architecture calls, and destructive, irreversible or
   security-sensitive choices (`ask-user-authority`). An escalated decision is held for
   the user. The Pivot's own answers are recorded and labeled as the Pivot's.
3. **Closing.** Only three things close a decision: the Pivot's answer sent to the
   teammate (answerer closes, #1842); the teammate itself, for a blocker that cleared
   with no answer and was never escalated; the Pivot marking it moot with evidence,
   labeled as not the user's words (#3872). A `done`, `failed` or `working` report never
   closes one, and neither does teardown (#3595). This takes the #1842 side of
   firstmate's contradiction. The stale decisions behind #3753 are handled by every wake
   listing open decisions and the Pivot closing moot ones explicitly.
4. **The user's answer goes through the Pivot.** The user answers in the Pivot view. T3
   records the exact words (firstmate caps them at 8 KB) and wakes the Pivot, which
   relays the answer to the teammate and closes the decision.
5. **Escalation shape.** Structured fields: one or more questions, evidence,
   consequence, options, recommendation. Several questions from one gate are one
   decision, answered together. The answer UI reuses
   `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx` (options plus free
   text).
6. **No "later".** firstmate's dated re-hold is out. An unanswered decision stays open
   and every wake lists it.

### Net-new

The decision record and its events (opened, escalated, answered, closed, marked moot),
and the Pivot's tools to answer, escalate and mark moot. Nothing in T3 holds a question
across threads.

### Knock-on

- Ticket 06: the steering message that carries an answer closes the decision it names.
- Ticket 07 amendment: the user answering an escalated decision is a wake item.
- Ticket 10: teardown never closes a decision. Decide what teardown does to a teammate
  with one open.
- Ticket 14: `ask-user-authority` prose carries into the Pivot's contract.
- Ticket 15: where held decisions sit in the Pivot view.
- Ticket 16: how a card shows an open or escalated decision.
- Ticket 18: an escalated decision is the main thing that should reach the user.

## Amendment from the model change (2026-09-29)

A decision belongs to a Pivot thread, not the project, and moves with a handover.
