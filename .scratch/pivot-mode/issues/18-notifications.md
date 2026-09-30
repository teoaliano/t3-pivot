# Which Pivot events notify the user

Type: grilling
Status: resolved
Blocked-by: 07, 08

## Question

Which Pivot mode events reach the user outside the Pivot view, and on which surfaces?

firstmate escalates immediately only for PR ready, finished findings, real blockers,
destructive or irreversible asks, and credential needs, and stays silent otherwise.
T3 notifies per thread on web and desktop (`ThreadNotificationCoordinator.tsx`) and
pushes to mobile (`AgentAwarenessRelay.ts`). With several teammates, per-thread
notifications become noise. Decide whether teammates notify at all, what the Pivot's
notifications carry, and how mobile push maps onto it.

## Carried forward from waking the Pivot

The wake set is `done`, `needs-decision`, `blocked`, `failed`, `unreported`, `waiting`,
plus `paused` rechecks and the 30-minute stuck bound, batched over 30 s.

## Carried forward from decisions

A decision escalated to the user is the main thing that should reach the user outside
the Pivot view.

## Resolution

**Decided 2026-09-29.** No drifts from firstmate.

- In Pivot mode the user hears only from the Pivot, and only about firstmate's
  escalate-now list (`AGENTS.md:510-517` at `a09090d`): a decision escalated to the user
  (which covers PR ready, destructive or irreversible asks, credential needs, and
  blockers the Pivot cannot clear), finished scout findings, and the Pivot's reply when
  the user was talking to it. Routine progress stays silent.
- Teammate threads stop firing T3's per-thread notifications
  (`ThreadNotificationCoordinator.tsx`) and mobile pushes (`AgentAwarenessRelay.ts`).
  Their events go to the Pivot. This changes T3's behavior for teammate threads, by
  firstmate's rule that crewmates never address the captain.
- An escalated decision maps to the relay's `waiting_for_input` phase on the Pivot
  thread, so mobile push needs no new phase.
