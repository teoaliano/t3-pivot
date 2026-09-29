# Which Pivot events notify the user

Type: grilling
Status: open
Blocked-by: 07, 08

## Question

Which Pivot mode events reach the user outside the Pivot view, and on which surfaces?

firstmate escalates immediately only for PR ready, finished findings, real blockers,
destructive or irreversible asks, and credential needs, and stays silent otherwise.
T3 notifies per thread on web and desktop (`ThreadNotificationCoordinator.tsx`) and
pushes to mobile (`AgentAwarenessRelay.ts`). With several teammates, per-thread
notifications become noise. Decide whether teammates notify at all, what the Pivot's
notifications carry, and how mobile push maps onto it.
