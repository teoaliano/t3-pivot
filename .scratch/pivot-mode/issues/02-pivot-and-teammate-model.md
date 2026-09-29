# Pivot and teammate in the orchestration model

Type: grilling
Status: claimed
Blocked-by: 01

## Question

How do the Pivot and its teammates exist in T3's event-sourced model?

Options range from a role field and a parent link on the existing thread aggregate
(`pivotThreadId` on a teammate, a Pivot marker on the project) to a separate teammate
aggregate that references a thread and carries the task contract, kind (ship or scout)
and status. Decide which, which new commands and events it needs, and how the read model
exposes it to the Pivot view and the sidebar grouping.

Constraints: a project has at most one Pivot. A teammate is 1:1 with a worktree, as in
firstmate's pool slots and T3's managed-process ownership. The shape must survive a
server restart with nothing held in memory. firstmate reference: `state/<id>.meta`,
`data/<id>/brief.md`.
