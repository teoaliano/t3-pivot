# Dispatch and the brief

Type: grilling
Status: open
Blocked-by: 02

## Question

What does the Pivot call to start a teammate, and what does T3 do with it?

Decide the dispatch inputs (title, the user's intent, the Pivot's spec, kind, definition
of done, base branch), who picks the teammate's provider and model (project default, the
Pivot, or the user), and how the brief reaches the teammate (first user message, runtime
instructions, or a file in the worktree).

T3 side: `dispatchBootstrapTurnStart` in `apps/server/src/ws.ts:1080` already creates a
thread, a worktree, runs setup and starts the first turn, but it is a closure in the WS
handler, and clients mint the temporary branch name. Decide how a server-side caller
reuses it. firstmate reference: `bin/fm-brief.sh`, `bin/fm-dod-lib.sh`, `bin/fm-spawn.sh`.

## Carried forward from firstmate contract triage

firstmate chooses harness and model by quota (`quota-array-dispatch` skill). The triage
found no bin for it. Decide here whether the Pivot does any of that, or only uses the
project default and what the user names.
