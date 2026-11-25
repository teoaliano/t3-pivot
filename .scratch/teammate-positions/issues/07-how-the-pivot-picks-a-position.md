# How the Pivot picks a position

Type: grilling
Status: open
Blocked-by: 01, 03

## Question

How does the Pivot choose a position and tell the server? Decide the `dispatch_teammate`
input (position by id or name in place of `kind`, model override, ship-or-inline choice
for a change), what the Pivot sees about each position (`text/AGENTS.md`, `list_teammates`),
what happens when the user names a position in chat, and which eval cases in `evals/`
must cover the new model-facing text.

From What a position is: `TeammatePositions.resolve` needs a fallback when the Pivot passes
no position id or an id that has since been deleted. Decide what it falls back to.
