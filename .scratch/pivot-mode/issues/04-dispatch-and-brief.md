# Dispatch and the brief

Type: grilling
Status: resolved
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

## Resolution

**Decided 2026-09-29.** Dispatch reuses T3's worktree bootstrap. The brief copies
firstmate's launch brief (`bin/fm-brief.sh`, `bin/fm-dod-lib.sh`).

1. **Reuse by moving.** `dispatchBootstrapTurnStart` (`apps/server/src/ws.ts:1080-1783`)
   moves into a server service with its helpers. The dispatch origin becomes an optional
   argument. The WS handler and Pivot dispatch both call it, and `ws.ts` keeps a call
   site. It uses no auth or session state.
2. **Inputs.** `dispatch_teammate { title, kind, intent, spec, baseBranch?,
modelSelection? }`. The server renders the brief from a fixed template: teammate role
   first (#3797), then the user's intent, the Pivot's spec, the rules (status protocol,
   stay in the worktree, full PR URLs, same obstacle twice means `blocked`, decisions go
   up), and the definition of done. The kind and the delivery mode (ticket 09) produce
   the definition of done, never the Pivot. The server refuses an empty intent or spec
   and an intent that opens with a speaker label (#3597).
3. **Provider, model, effort.** The project's default model selection, unless the user
   named one for this work. With no project default, the Pivot's own. Effort follows
   firstmate's fallback: low for clear work, extra-high for ambiguous design, never max
   without the user asking. Runtime mode is the project's default (full-access unless
   changed). No quota profiles.
4. **Delivery of the brief.** The rendered brief is the teammate's first message, as in
   firstmate. No adapter changes; runtime instructions stay static
   (`RuntimeInstructions.ts`). Messages the Pivot sends a teammate carry a Pivot marker
   and render as the Pivot's words, the brief collapsed. The brief's fields are also
   stored on the dispatch event, write-once.
5. **Branch.** The server derives `pivot/<slug of the title>`, with a suffix if taken,
   and passes it as the final branch, which skips T3's generated rename
   (`ProviderCommandReactor.ts:905`). Immutable after dispatch. Scouts get one too.
6. **Base.** The origin's default branch, fetched fresh, worktree required. The Pivot
   can pass `baseBranch` to stack on another branch.
7. **Result and failure.** Dispatch returns once the thread and worktree exist and the
   first turn has started, and setup progress shows on the card. A failing setup script
   still starts the teammate, as today, and the result says so. A failing bootstrap
   returns the error, leaves no teammate, and removes any worktree it created, which
   today only a cancel does.
8. **Promotion.** `promote_teammate { teammate, spec }` flips the kind and sends the
   superseding contract (ship rules, new spec, original intent kept) as a Pivot message.
   The brief is never overwritten (`bin/fm-promote.sh`).

### Net-new

The bootstrap service extraction, the brief template, the Pivot message marker, and the
`dispatch_teammate` and `promote_teammate` tools.

### Knock-on

- Ticket 06: steering messages use the Pivot marker.
- Ticket 09: the delivery mode feeds the definition of done.
- Ticket 12: dispatch and promote are Pivot-only tools.
- Ticket 14: the brief template's rule text is part of what the Pivot never has to say.
- Ticket 17: the expanded teammate renders Pivot messages and the collapsed brief.

## Amendment from notifications

Decision 3 said teammates take the project's default runtime mode. firstmate's workers
never wait on a human: they launch with the harness's permission prompts bypassed. So
teammates always run full-access, whatever the project default. The `waiting` wake stays
as a safety net for a user who changes one by hand.
